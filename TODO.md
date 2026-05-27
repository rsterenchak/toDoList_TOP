# TODO List

- [x] **[HIGH]** Fix UTF-8 corruption in inject button request body
  - Type: bug
  - Description: Descriptions injected through the inject button arrive in TODO.md with severely double-encoded Unicode characters â em-dashes and other non-Latin-1 characters appear as long runs of `Ãï¿½Ã...` byte sequences. The description displays correctly in the PWA UI, so Supabase reads/writes are fine and the data on screen is correct UTF-8. The corruption happens inside the inject button's click handler in `main.js` (or `inject.js` if split out) before the POST hits the network. The Cloudflare Worker's own UTF-8 handling is correct (verified by `curl`-ing a clean em-dash-containing entry through the Worker, which lands correctly in the repo) â the Worker is faithfully committing the corrupted bytes the PWA sends. Likely cause: the handler applies a manual encoding step like `unescape(encodeURIComponent(text))`, `String.fromCharCode(...new TextEncoder().encode(text))`, or a redundant `btoa()`/manual byte-walk pattern from the old "make btoa work on Unicode" workaround. None of these are needed â `JSON.stringify` plus `fetch` handle Unicode correctly out of the box. Fix by removing any encoding transformation on the entry string between reading it from the description field and assembling the fetch body. The body should be `JSON.stringify({ entry: description, repo: target.repo, filePath: target.file_path })` with `description` passed through as-is.
    - Acceptance criteria:
      - Inject a todo whose description contains em-dashes (â), curly quotes (" "), or other non-ASCII characters; the resulting commit in TODO.md contains those characters intact, not as `Ãï¿½Ã...` byte sequences.
      - The PWA's network request body (visible in DevTools) shows the description as clean UTF-8 prior to send.
      - Existing injects that already landed corrupted in TODO.md are not affected by this fix (they're committed history); only future injects benefit.
      - No regression on plain-ASCII descriptions (which currently inject fine).
    - Implementation notes:
      - Grep `main.js` (and `inject.js` if it exists) for `encodeURIComponent`, `unescape`, `escape`, `btoa`, `String.fromCharCode`, and `TextEncoder` near the inject button's click handler. Any of these touching the entry string before the fetch is the bug.
      - The correct fetch shape is plain JSON: `body: JSON.stringify({ entry, repo, filePath })`. `Content-Type` header should be `application/json`. No `Content-Encoding` header.
      - Add a small test in `tests/inject.test.js` (or wherever the inject handler tests live) that mocks `fetch`, calls the inject handler with a description containing an em-dash, and asserts the captured fetch body's `entry` field roundtrips through `JSON.parse` to the original em-dash-containing string.
      - The Worker code (`todo-injector-worker/src/index.js`) needs no changes â its `TextEncoder`-based base64 step is correct and should be preserved.
    - Out of scope: Cleaning up the already-corrupted entries in TODO.md (do that manually in a separate commit when convenient); refactoring the inject handler beyond what's needed for this fix.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-05-27

- [ ] **[MEDIUM]** Auto-resort todo into correct position when its due date changes
  - Type: bug
  - Description: When a new task is created its due date defaults to one week out, which drops it somewhere in the middle of the list. Editing that due date afterward updates the value but the row stays in its original DOM position, even though "Sort by Due" is active — the list only reflects the new ordering after a manual sort toggle or a page reload. Expected behavior: any due-date change while "Sort by Due" is checked should immediately reposition the row to its correct slot in the sorted order. Likely cause is that the due-date popover's save handler in `main.js` writes the new value through `listLogic.js` but never calls the existing sort-and-rerender path used by the Sort by Due toggle — investigate the popover's confirm/save path (`showDueDatePopover` / due-date save handler) and have it invoke the same sort+rerender used when toggling the sort mode, gated on whether `Sort by Due` is currently active. DOM child count remains the source of truth for blank-row decisions during the rerender. Add a regression test in `tests/listLogic.test.js` covering: with Sort by Due active, mutating a todo's due date reorders it relative to its peers.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
