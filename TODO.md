# TODO LIST

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
