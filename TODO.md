# TODO List

- [x] **[MEDIUM]** Add read-only TODO.md viewer card below the Completed section
  - Type: feature
  - Description: For projects that have an inject target assigned (via the Configure Inject modal's project routing), render a card in the empty space below the "Completed (N)" section that displays the current contents of that project's mapped TODO.md, fetched live from the todo-injector-worker. The card has a tabbed header Ã¢ÂÂ "Rendered" (parsed checklist view) and "Raw markdown" (monospace plaintext, preserving the file's newlines) Ã¢ÂÂ a "synced Xd ago" timestamp reflecting the last successful viewer fetch, and a "Sync" button that re-fetches on demand. View-only for now (no write-back / editing). Match the dark "Void" aesthetic: near-black card surface, `#1e1e2a` borders, `#6C5DF5`/`#9D93EE` purple accents, active tab underlined in `#6C5DF5`, Trebuchet MS body / monospace for the raw tab. The card mirrors the Completed section's placement and only appears when the selected project routes to a target Ã¢ÂÂ hide entirely for None-routed projects (Notes, Idea dump, Work/Study).
  - Behavior:
    1. On project select, check whether that project has an inject target in the routing config. If none, render nothing (no card, no placeholder).
    2. If a target exists, render the viewer card below Completed, defaulting to the "Rendered" tab, and fetch the file (see Worker contract below). Parse markdown checklist lines (`- [ ]` / `- [x]`) into rows for the rendered view; show the verbatim file text in the raw view.
    3. Tab toggle swaps between rendered and raw without re-fetching.
    4. "Sync" re-fetches, updates the displayed content, and resets the timestamp to "just now". Show a brief loading/disabled state on the button during the request.
    5. The "synced Xd ago" timestamp reflects the last successful viewer fetch (read), persisted per-project so it survives reloads Ã¢ÂÂ distinct from the last inject (write).
  - Worker contract (already deployed):
    - POST to the todo-injector-worker with `Authorization: Bearer <SHARED_SECRET>`, `Content-Type: application/json`, body `{ "read": true, "repo": "<owner/name>", "filePath": "TODO.md" }`.
    - Success 200: `{ ok: true, content: "<UTF-8 file text>", sha, repo, filePath }`. `content` is a JSON string with `\n` newlines Ã¢ÂÂ `response.json()` decodes it; render the `content` string directly (newlines become real line breaks in the raw `<pre>`).
    - Errors: 401 unauthorized, 400 `{ error: "Target not in allowlist" }`, 502 `{ error: "GitHub GET failed" }`. Surface a non-crashing inline error state in the card for any non-ok response.
  - Implementation notes:
    - Reuse the same stored Worker URL + SHARED_SECRET the existing inject/test-connection calls already read (entered by the user via the Inject settings "Connection" editor and persisted client-side) Ã¢ÂÂ do NOT add a separate config surface for the viewer. Derive `repo`/`filePath` from the selected project's inject target in the routing config (e.g. Task Management App Ã¢ÂÂ `rsterenchak/toDoList_TOP` ÃÂ· `TODO.md`).
    - Persist the per-project last-fetch timestamp under the `todoapp_` localStorage prefix (e.g. `todoapp_todomd_lastfetch`), keyed by project.
    - No new dependencies Ã¢ÂÂ parse the markdown checklist with a small vanilla helper, not a markdown library.
    - Card rendering/wiring lives in `main.js` (the Completed section and Inject modal wiring are there); investigate with grep + offset/limit, not a full read. The routing config + Worker-call helper used by inject/test-connection are the things to locate and reuse for the read.
  - Acceptance criteria:
    - Viewer appears only for projects with an inject target; absent for None-routed projects.
    - Both tabs render correctly; toggling between them doesn't re-fetch; raw tab preserves newlines.
    - Sync re-fetches and updates the timestamp; a failed/non-ok response surfaces an inline error state, not a blank or broken card.
    - Timestamp persists across reloads and reflects last read, not last write.
  - Out of scope: editing/writing TODO.md from the viewer, syntax highlighting beyond the priority-tag accent, auto-refresh polling, viewing MEDO.md (TODO.md only for now).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-28

- [x] **[LOW]** Fix Sync button overflow in TODO.md viewer header by dropping the repoÂ·path label
  - Type: bug
  - Description: In the TODO.md viewer card's header, the Sync button overflows off the right edge on mobile because the meta row tries to fit the repoÂ·path text, the "synced Xd ago" timestamp, and the Sync button on one line â there isn't enough horizontal room at ~380px, so Sync pushes past the card boundary. Fix by removing the `rsterenchak/toDoList_TOP Â· TODO.md` repoÂ·path label from the header entirely (it's redundant â the selected project already tells the user which file they're viewing), leaving just the "synced Xd ago" timestamp on the left and the Sync button on the right of the meta row. Apply this layout on both mobile and desktop (single layout, no breakpoint fork) so there's one header style to maintain. Keep the timestamp left-aligned with its clock icon and the labeled Sync button right-aligned, matching the existing "Void" styling (`#161622` button fill, `#2a2a38` border, `#9D93EE` text/icon).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-28

- [ ] **[LOW]** Add expand/collapse toggle to TODO.md viewer card to fill available space
  - Type: feature
  - Description: The TODO.md viewer's content area is currently a fixed-height scroll box, leaving empty card space below it (especially on desktop) while the user scrolls a cramped window inside. Add an expand/collapse icon button in the card header, immediately to the right of the Sync button, that toggles the content area between its default compact fixed height and an expanded height that fills the available open space below the Completed section. Default state is collapsed. The expanded state grows the content area (scrolling only if the file is longer than the expanded height); collapsing returns it to the compact fixed height. Persist the toggle state per-project in localStorage so each project remembers whether its viewer was left expanded. Match the "Void" styling: `#161622` button fill, `#2a2a38` border, `#9D93EE` icon, sized as a compact icon button (~28px) consistent with the header. Use a diagonal-arrows / expand icon when collapsed and a collapse icon when expanded, with an `aria-label` reflecting the action.
  - Behavior:
    1. Render an expand toggle icon button in the header, right of Sync. Default = collapsed (current fixed-height behavior unchanged).
    2. Tapping expand grows the content area to fill the available space below Completed; the inner content scrolls only when it exceeds that height. The icon and `aria-label` flip to the collapse action.
    3. Tapping collapse returns the content area to the compact fixed height.
    4. Persist the expanded/collapsed boolean per-project under the `todoapp_` localStorage prefix (e.g. `todoapp_todomd_expanded`, keyed by project). On project select / reload, restore that project's last state.
    5. State applies to whichever tab (Rendered / Raw) is active — toggling tabs does not change expand state.
  - Implementation notes:
    - The expanded height must flex into a container with a known/resolved height — a bare flex-fill will silently collapse if the parent chain has no explicit height (same root cause as the prior music-visualizer bar issue). Confirm the card's container resolves a height before relying on flex-grow; otherwise compute the available space explicitly (viewport minus fixed footer minus the elements above the content area).
    - Toggle wiring and the per-project state read/write live in `main.js` alongside the existing viewer card and Sync handler; investigate with grep + offset/limit, not a full read.
    - Reuse the existing per-project localStorage keying pattern already used for the viewer's last-fetch timestamp.
  - Acceptance criteria:
    - Toggle appears right of Sync, defaults to collapsed, and flips icon + aria-label on each tap.
    - Expanding fills the open space; content scrolls only when longer than the expanded area; collapsing restores the compact height.
    - State persists per-project across reloads and project switches.
    - Expanded view renders correctly (no zero-height collapse) on both mobile and desktop.
  - Out of scope: drag-to-resize / arbitrary heights, remembering scroll position, animating the height transition beyond a simple CSS transition.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
