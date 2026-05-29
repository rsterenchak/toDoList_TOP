# TODO List

- [ ] **[MEDIUM]** Add run-entry and run-backlog controls to the TODO.md viewer
  - Type: feature
  - Description: Add two ways to trigger the Claude Code automation routine from inside the app. (1) A per-row "Run this entry" item in the existing todo-row ⋮ overflow menu that runs the routine in entry mode against that specific todo, matched by the todo's own id. (2) A "Run backlog" text button in the TODO.md viewer card header, placed immediately left of the existing Sync button and styled to match it (`#161622` fill, `#2a2a38` border, `#9D93EE` text, compact, with a leading play glyph), that runs the routine in backlog mode (next eligible task). Both actions fire by POSTing to the same Cloudflare Worker the existing inject flow already uses — the client never calls GitHub directly or holds a token. The todo's id is the single join key across the todo object, the TODO.md `<!-- id: <id> -->` marker, and the dispatch payload; do NOT mint a new id at inject or run time — read the existing id off the todo object (the same id the data model already persists).
  - Behavior:
    1. Header "Run backlog" button: always active; on click, POST a backlog-mode run request to the Worker (with a freshly generated correlation_id) and show a brief transient confirmation that the run was dispatched.
    2. Row ⋮ "Run this entry": always active (NOT gated on a cached "injected" flag — that flag is unreliable across refresh/devices). On click, read the todo's id, then check the viewer's current near-live TODO.md copy for that id's `<!-- id: <id> -->` marker.
    3. If the marker is absent, inject first: POST the inject request (carrying the todo's id) and AWAIT its completion before dispatching — the inject commits to TODO.md and the dispatched workflow does a fresh checkout, so the commit must land first or entry mode won't find the marker.
    4. Then POST an entry-mode run request (todo id as entry_id, plus a correlation_id) and show the same transient confirmation.
    5. Re-running an already-injected entry skips the inject step and goes straight to dispatch.
  - Implementation notes:
    - All three of the viewer header, the row ⋮ menu wiring, and the existing inject POST live in `main.js`; it is over 25k tokens, so locate them with grep + offset/limit (todoMdViewer, the ⋮/overflow menu handler, the inject/Worker fetch helper) rather than reading the file in full.
    - The inject request payload must include the todo's id (`id` field) so the Worker's dedup guard can match; the run requests POST `dispatch: true` with `mode` (backlog|entry), `entry_id`, and a `correlation_id`. The Worker's dispatch branch returns `{ok:true,dispatched:true,...}` on success; treat the inject `{skipped:true}` response as success too. Use native `fetch` (no new deps).
    - On mobile the viewer card is moved into the bottom sheet, so style the header "Run backlog" button with a class the rule covers in both the inline and in-sheet instances (the same pattern the Sync button already follows).
    - The ⋮ menu already exists and already closes the required ways — only add the new item; don't rebuild the menu.
  - Out of scope: the full queued → running → PR-opened status pill and its polling (separate TODO.md entry — this entry only shows a transient "dispatched" confirmation, then optionally opens the run's Actions URL). The Worker-side dispatch endpoint, status branch, dedup guard, and token scope are already built and deployed, so they're not part of this entry.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
