# TODO List

## Bugs

- [x] **[LOW]** Replace pixel-art Pomodoro icon with stroke-based stopwatch
  - Description: Swap the existing pixel-art clock SVG inside `pomodoroToggle.innerHTML` for a stroke-based stopwatch — crown bar + stem on top, side stem button on the upper right, circular dial, single hand. The new design uses a 24×24 viewBox (was 14×14) so the hand's rotation pivot moves from (7, 7) to (12, 14); `syncPomodoroIcon`'s rotate string and the `.clockIconHand` `transform-origin` in `style.css` must move in lockstep with the SVG or the sweep will be off-center. The `.clockIconBody`, `.clockIconFace`, and `.clockIconPivot` classes become vestigial once the new SVG is flat-stroked rather than grouped — remove them in the same commit so the cleanup doesn't drift into a follow-up.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-06

## Features

- [ ] **[LOW]** Remove Compact titles toggle and supporting code
  - Description: Remove the Compact titles button (stacked-lines glyph in the Todo Items header, left of Expand All) and all of its supporting code. In `main.js`, drop the `COMPACT_TITLES_SVG` constant, the `compactTitlesBtn` element, the `applyCompactTitles()` function and its boot-time call, the `syncCompactTitlesBtn()` helper, the click handler, the `bulkDescActions.appendChild(compactTitlesBtn)` line, and the `isCompactTitlesOn` / `setCompactTitlesOn` imports. In `prefs.js`, drop `COMPACT_TITLES_KEY`, `isCompactTitlesOn`, and `setCompactTitlesOn`. In `style.css`, drop the `.compactTitlesBtn` / `.compactTitlesIcon` rules and the `html[data-compact-titles="on"] #toDoInput` truncation rules (including the `:not(:has(.recurringGlyph)) #duePill` margin rule); also revisit the `#bulkDescActions` segmented-button styling since only Expand All will remain — the first/last-child border-radius split and `button + button` overlap rule become no-ops, so simplify back to a single button. Leaves the legacy `todoapp_compactTitles` localStorage key orphaned for existing users, which is fine — no migration needed.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/prefs.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
