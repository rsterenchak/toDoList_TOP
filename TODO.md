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

- [ ] **[LOW]** Remove the TODAY view code (keep tab in place for now)
  - Type: feature
  - Description: Remove the TODAY view code from the app without changing the bottom nav or any tab labels. The TODAY view rendering function (`renderTodayDashboard`), the date-header refresh function (`refreshTodayDateHeader`), the `todaySections` DOM container, the `.todayRow.todoRowCard` row markup builder, any TODAY-specific helpers, and any internal references that *exclusively* serve TODAY rendering are removed. The internal `'today'` view identifier in `applyActiveView`, the `viewPillToday` element, the `mobileTabToday` element, the `data-view="today"` CSS branch, and the keyboard navigation handlers for TODAY are LEFT IN PLACE — those will be renamed in the next entry. Tapping the TODAY tab after this entry merges should still set `data-view="today"` and not crash; the view area renders nothing (blank) because the dashboard function it called no longer exists. This intermediate state is intentional — the next entry renames TODAY → INBOX, and the entry after that adds an INBOX placeholder view. Once all three ship, the TODAY tab is gone and INBOX is a working placeholder.
  - Implementation notes:
    - Find and DELETE the following functions and their call sites (if these names don't match exactly, find by behavior — TODAY-specific rendering and helpers):
      - `renderTodayDashboard` (the function that builds the TODAY view's contents)
      - `refreshTodayDateHeader` (the function that updates the date header text shown on TODAY)
      - Any helper functions exclusively used by `renderTodayDashboard` — e.g., functions that build `.todayRow.todoRowCard` markup, functions that filter todos by due-today
      - Any TODAY-specific DOM creation in `component()` — the code that creates `#todaySections` and its initial markup
    - In `applyActiveView`, the `if (safe === 'today') { refreshTodayDateHeader(); renderTodayDashboard(); }` branch — **replace the function calls inside the branch with a comment**: `// TODAY view removed; placeholder INBOX view ships in a follow-up entry`. Leave the `if (safe === 'today')` branch itself in place so the routing logic still recognizes the identifier.
    - In `firstFocusableInActiveMainView`, the `if (view === 'today') { ... }` branch — replace its body with `return null;` and a comment explaining why. The function shouldn't try to find a focusable element in a view that no longer renders anything.
    - **DO NOT** rename any `'today'` strings to `'inbox'` anywhere — that's the next entry's work. Leave identifiers untouched.
    - **DO NOT** rename `viewPillToday`, `mobileTabToday`, `todaySections`, or any other DOM IDs or class names — same reason. The next entry handles renaming.
    - **DO NOT** change the bottom nav tab label or icon — the tab still says "TODAY" after this entry.
    - **DO NOT** add an INBOX view or placeholder — that's two entries away. After this entry, tapping TODAY shows a blank/empty main area, which is the intended intermediate state.
    - The due-date field on tasks is preserved — only the dedicated TODAY view rendering goes. Due date functions in `dueDate.js` (`applyDueUrgency`, `updateDuePillLabel`) stay, due-date inputs on task creation stay, the calendar view stays. Only TODAY-specific rendering is removed.
    - Remove or update any tests that exclusively test the TODAY view (e.g., tests for `renderTodayDashboard`, date-header tests). Don't remove tests that happen to use TODAY incidentally as a backdrop for testing something else (like keyboard nav tests that switch to TODAY as part of their setup — those just need the test fixture updated to handle the missing view gracefully, or skipped with a comment if rewriting them now is out of scope).
    - **Critical**: do NOT modify the TODO.md viewer, the CALENDAR view, the PROJECTS view, the pomodoro popover code, the music popover code, or anything else not directly related to TODAY view rendering. This entry is deletion-only and tightly scoped.
    - Add or update tests for: (a) `renderTodayDashboard` is no longer exported / referenced anywhere in the codebase (grep-style check via tests or just verify in PR diff), (b) `applyActiveView('today')` does not crash (it sets `data-view="today"` and the routing recognizes it), (c) other views (PROJECTS, CALENDAR) still render correctly, (d) due-date field on tasks still works.
  - Out of scope: renaming TODAY → INBOX in any identifier, label, or DOM ID (next entry); adding an INBOX placeholder view (the entry after); CALENDAR → SETTINGS rename (much later); any voice mic, pomodoro, radio, or other changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 89ab2093-c930-4523-910c-d1af70edaf85 -->
