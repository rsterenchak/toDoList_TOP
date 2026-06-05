# TODO LIST

- [ ] **[LOW]** Rename TODAY → INBOX in bottom nav + remove TODAY view code
  - Type: feature
  - Description: Rename the TODAY tab in the bottom navigation to INBOX. Remove the existing TODAY view code entirely (the date-based "items due today across all projects" filtering logic and rendering). Replace the tab's behavior with a temporary placeholder view that displays the text "Inbox coming soon" centered on the screen — a follow-up entry will implement the actual INBOX functionality. CALENDAR tab is unchanged. The due-date field on tasks is preserved (only the dedicated TODAY view is removed, not the underlying capability).
  - Implementation notes:
    - Bottom nav: rename "TODAY" to "INBOX" in markup and any internal route/state identifiers (likely a string like `'today'` becomes `'inbox'`). Update the icon if there's a today-specific icon (sun, target, etc.) to an inbox-appropriate one (inbox tray, download arrow). Use existing icon library or simple inline SVG/unicode.
    - Remove the old TODAY view code entirely:
      - The component or rendering function for the today view
      - The date-filtering logic that produced "items due today"
      - Tests for the today view (these need to go too, otherwise tests fail)
      - Imports of the now-removed module
      - Any "today" string identifiers in route/state handling that referred to this specific view
    - The due-date field on tasks is NOT removed. Tasks still have due dates as metadata. The agent must NOT remove the due-date column from Supabase, NOT remove date-related fields from listLogic.js, NOT remove date inputs from the task-creation UI.
    - Temporary INBOX view: a single component that renders centered muted text "Inbox coming soon" — no list, no compose row, no query to Supabase. This is intentional scaffolding to be replaced in the next entry. Style: muted text color `#5a5a6a`, centered both horizontally and vertically in the view area, ~14px font.
    - The bottom nav highlighting (showing INBOX as selected when on the inbox tab) should work the same way TODAY's selected state worked. Just reuse the existing pattern.
    - **Critical**: do NOT modify the TODO.md viewer or any component reading from `TODO.md`. This entry only affects the bottom navigation and removes the old date-based view.
    - **Critical**: CALENDAR tab is unchanged. Do NOT touch CALENDAR-related code.
    - **Critical**: do NOT attempt to build the actual cross-project ideas view in this entry. That's the next entry. The placeholder "Inbox coming soon" is the entire INBOX functionality for now.
    - Add tests for: (a) the bottom nav shows INBOX (not TODAY) at the middle position, (b) tapping INBOX renders the placeholder view, (c) the old TODAY view code is fully removed (no orphaned routes, no orphaned imports), (d) CALENDAR tab still works as before, (e) due-date field on tasks still works (creating a task with a due date persists the date).
  - Out of scope: actual INBOX functionality (next entry), CALENDAR → SETTINGS rename, any other changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 2d630e83-5cdb-4855-a901-d20c74f230b6 -->


