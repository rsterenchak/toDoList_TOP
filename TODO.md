# TODO List

- [x] **[MEDIUM]** Add read-only TODO.md viewer card below the Completed section
  - Type: feature
  - Description: For projects that have an inject target assigned (via the Configure Inject modal's project routing), render a card in the empty space below the "Completed (N)" section that displays the current contents of that project's mapped TODO.md, fetched live from the todo-injector-worker. The card has a tabbed header — "Rendered" (parsed checklist view) and "Raw markdown" (monospace plaintext, preserving the file's newlines) — a "synced Xd ago" timestamp reflecting the last successful viewer fetch, and a "Sync" button that re-fetches on demand. View-only for now (no write-back / editing). Match the dark "Void" aesthetic: near-black card surface, `#1e1e2a` borders, `#6C5DF5`/`#9D93EE` purple accents, active tab underlined in `#6C5DF5`, Trebuchet MS body / monospace for the raw tab. The card mirrors the Completed section's placement and only appears when the selected project routes to a target — hide entirely for None-routed projects (Notes, Idea dump, Work/Study).
  - Behavior:
    1. On project select, check whether that project has an inject target in the routing config. If none, render nothing (no card, no placeholder).
    2. If a target exists, render the viewer card below Completed, defaulting to the "Rendered" tab, and fetch the file (see Worker contract below). Parse markdown checklist lines (`- [ ]` / `- [x]`) into rows for the rendered view; show the verbatim file text in the raw view.
    3. Tab toggle swaps between rendered and raw without re-fetching.
    4. "Sync" re-fetches, updates the displayed content, and resets the timestamp to "just now". Show a brief loading/disabled state on the button during the request.
    5. The "synced Xd ago" timestamp reflects the last successful viewer fetch (read), persisted per-project so it survives reloads — distinct from the last inject (write).
  - Worker contract (already deployed):
    - POST to the todo-injector-worker with `Authorization: Bearer <SHARED_SECRET>`, `Content-Type: application/json`, body `{ "read": true, "repo": "<owner/name>", "filePath": "TODO.md" }`.
    - Success 200: `{ ok: true, content: "<UTF-8 file text>", sha, repo, filePath }`. `content` is a JSON string with `\n` newlines — `response.json()` decodes it; render the `content` string directly (newlines become real line breaks in the raw `<pre>`).
    - Errors: 401 unauthorized, 400 `{ error: "Target not in allowlist" }`, 502 `{ error: "GitHub GET failed" }`. Surface a non-crashing inline error state in the card for any non-ok response.
  - Implementation notes:
    - Reuse the same stored Worker URL + SHARED_SECRET the existing inject/test-connection calls already read (entered by the user via the Inject settings "Connection" editor and persisted client-side) — do NOT add a separate config surface for the viewer. Derive `repo`/`filePath` from the selected project's inject target in the routing config (e.g. Task Management App → `rsterenchak/toDoList_TOP` · `TODO.md`).
    - Persist the per-project last-fetch timestamp under the `todoapp_` localStorage prefix (e.g. `todoapp_todomd_lastfetch`), keyed by project.
    - No new dependencies — parse the markdown checklist with a small vanilla helper, not a markdown library.
    - Card rendering/wiring lives in `main.js` (the Completed section and Inject modal wiring are there); investigate with grep + offset/limit, not a full read. The routing config + Worker-call helper used by inject/test-connection are the things to locate and reuse for the read.
  - Acceptance criteria:
    - Viewer appears only for projects with an inject target; absent for None-routed projects.
    - Both tabs render correctly; toggling between them doesn't re-fetch; raw tab preserves newlines.
    - Sync re-fetches and updates the timestamp; a failed/non-ok response surfaces an inline error state, not a blank or broken card.
    - Timestamp persists across reloads and reflects last read, not last write.
  - Out of scope: editing/writing TODO.md from the viewer, syntax highlighting beyond the priority-tag accent, auto-refresh polling, viewing MEDO.md (TODO.md only for now).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-28
