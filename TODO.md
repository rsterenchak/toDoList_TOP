# TODO List

- [x] **[MEDIUM]** Add a "Run backlog" button to the TODO.md viewer card header
  - Type: feature
  - Description: Add a "Run backlog" text button to the TODO.md viewer card header, placed immediately left of the existing Sync button and styled to match it (`#161622` fill, `#2a2a38` border, `#9D93EE` text, compact, with a leading play glyph). On click it triggers the Claude Code automation routine in backlog mode (the routine selects the next eligible task). It fires by POSTing to the same Cloudflare Worker the existing inject/sync flow already uses — the client never calls GitHub directly or holds a token.
  - Behavior:
    1. The "Run backlog" button is always active (it does not depend on any per-todo state).
    2. On click, generate a fresh correlation_id (e.g. `crypto.randomUUID()`), then POST a backlog-mode run request to the Worker.
    3. On a successful dispatch, show a brief transient confirmation that the run was dispatched (reuse the existing inject toast pattern — `showInjectToast`-style — so styling matches), optionally including a link to the run's Actions page.
    4. On failure, show the same toast in its error variant with a short reason.
    5. While a request is in flight, disable the button (mirror the Sync button's `disabled` + loading-class pattern) so a double-click can't fire two dispatches.
  - Implementation notes:
    - The viewer card header is built in `buildTodoMdViewerCard` in `main.js`, where the `syncBtn` is created (`syncBtn.className = 'todoMdViewerSyncBtn'`, around line 5718) and appended to `meta` (around line 5744). Add the new button right before `syncBtn` in `meta` so it sits to its left. Locate with grep + offset/limit — `main.js` is large.
    - The existing Worker call path lives in `inject.js`: `postToWorker(payload)` is the low-level POST (reads the cached Worker URL + shared secret, sets the Bearer header). Add and export a new helper there — e.g. `dispatchRun({ mode, entryId, correlationId, target })` — that calls `postToWorker({ dispatch: true, mode, entry_id: entryId || '', correlation_id: correlationId, repo: target?.repo, filePath: target?.file_path })` and returns `{ ok, ... }` using the same `describeError` mapping the other helpers use. Import it into `main.js` alongside `readTodoMdFromWorker`.
    - The Worker's dispatch branch returns `{ ok: true, dispatched: true, ... }` on success. Use native `fetch` only (no new deps) — `postToWorker` already uses it.
    - On mobile the viewer card is moved into the bottom sheet (DOM move preserving listeners), so the click handler keeps working there automatically. Style the button with a class the existing viewer-header rule covers in both the inline and in-sheet instances, the same way `todoMdViewerSyncBtn` is handled.
  - Out of scope: any per-todo "Run this entry" / entry-mode control (deferred to a separate entry — the app has no per-row overflow menu to host it, so that work needs its own design pass and mount point). The full queued → running → PR-opened status pill and its polling (separate entry — this entry only shows a transient "dispatched" confirmation). The Worker-side dispatch endpoint, status branch, dedup guard, and token scope are already built and deployed.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/inject.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-29
