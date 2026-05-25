# TODO List

## Bugs

- [x] **[HIGH]** Fix statsMissCallout band rendering outside #statsSibling on mobile
  - Description: With the mobile single-row recency strip in place, the `.statsMissCallout` band ("ⓘ Missed <date>") and the `.statsMissedList` row below it still render outside the `#statsSibling` drawer's visual border on phone-width viewports (≤420px) — the callout sits on top of the next `#toDoChild`. The drawer's grid track in `#mainList` is sizing to the strip's height plus the elements above it, but not including the callout / missed-pill row below the strip. Likely cause: the strip's SVG declares an explicit `height="16"` so the track grows for the SVG itself, but the callout and pill row that follow inside the same flex column aren't being accounted for in the track's `auto` measurement on mobile — either because of margin collapse against the drawer's `padding-bottom`, or because the callout's flex layout (`align-items: center`) on a wrapped-to-multi-line `.statsMissCalloutText` produces a height that's measured after track sizing finalizes. Investigate which: open the drawer on a 380px viewport with a daily-cadence recurring task and one miss, and use DevTools to inspect `#statsSibling`'s computed height vs. its scroll height. If they differ, the grid track is the culprit. Likely fixes (try in order): (a) confirm `#statsSibling` itself doesn't carry a `max-height` or `overflow: hidden` on mobile that would clip the callout — if it does, remove it; (b) ensure the drawer's `display: flex; flex-direction: column` continues to size to content height (no implicit `height: auto` override); (c) if the callout's `.statsMissCalloutText` wraps to two lines on narrow viewports and pushes the band height past what the parent measured, add `min-height: 0` to `.statsMissCallout` or move the icon to a fixed-size leading column via grid instead of flex. The drawer must contain every child it currently renders — strip, callout, and missed-pill list — within its visual border on a 380px viewport.
  - Behavior:
    1. On viewports ≤420px, opening the stats drawer with a daily-cadence task that has at least one miss reserves enough vertical height in the `#mainList` grid track to contain the stat-card strip, window toggle, `LAST 14` caption, recency-strip SVG, oldest/today label row, `.statsMissCallout`, AND `.statsMissedList` — all inside `#statsSibling`'s visual border.
    2. `.statsMissCallout` does not visually overlap the next `#toDoChild`.
    3. `.statsMissedList` (the `MISSED: <pill>` row) renders inside the drawer, above the next row.
    4. Desktop drawer rendering is unchanged.
  - Implementation notes:
    - First diagnostic step: inspect computed vs. scroll height of `#statsSibling` on a 380px viewport to confirm the grid track is the clip layer. Use the `todo-interaction-tree` skill on the stats-toggle interaction if the cause isn't obvious.
    - Check whether the prior mobile-strip PR added a mobile-only `max-height`, `overflow: hidden`, or fixed `height` to `#statsSibling`, `.statsGridWrapper`, or any drawer-internal wrapper — if so, that's the clip.
    - If margin-collapse between the drawer's `padding-bottom: 12px` and the callout's `border-radius` band is at fault, switching the callout's margin scheme (or removing top margin on a leading callout) may resolve it without grid changes.
    - The `grid-auto-rows: minmax(54px, auto)` declaration on `#mainList` is already correct (`mainListStatsDrawerHeight.test.js` enforces it) — don't touch it.
  - Acceptance criteria:
    - On a 380px viewport with the drawer open for a task with one or more misses, the drawer's bottom border sits below `.statsMissedList`.
    - Next todo row starts below the drawer with the usual inter-row gap; no visual overlap.
    - Add a regression test asserting that whatever the fix turns out to be (a removed `max-height`, an added `min-height`, a layout change) stays in place — mirroring `mainListStatsDrawerHeight.test.js` and `statsGridAxisLabels.test.js` patterns.
  - Out of scope: changing the strip's cell size or layout; restyling the callout or pill row; changing the desktop drawer.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/` (new regression test alongside the existing stats-drawer tests)
  - Completed: 2026-05-25

- [ ] **[MEDIUM]** Hide checkbox on mobile and rely on existing swipe-right to complete
  - Description: On `≤700px` viewports the `#checkToDo` square at the left of each todo row is visually redundant — swipe-right-to-complete is already wired in `toDoRow.js` via `attachToDoDrag`'s `swipeTargets.onRight`, which programmatically toggles `checkToDo.checked` and dispatches its existing `change` event, so the data path and completion micro-interaction are unchanged. Hide the checkbox at the mobile breakpoint in `style.css` (`#checkToDo { display: none; }` inside `@media (max-width: 700px)`) so the title gets the reclaimed horizontal space; the desktop layout keeps the checkbox exactly as today. Don't remove the element from the DOM — `swipeTargets.onRight` guards on `cb.style.display === 'none'` and the swipe path needs `checkToDo` to exist so it can flip `.checked` and fire the change event the persistence layer listens for. Verify swipe-right still completes/uncompletes from a mobile viewport, that the strikethrough + slide-to-Completed animation still plays, and that the completed-section toggle continues to surface re-open via swipe.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Increase mobile todo-row edge gutter and shrink title font to recover horizontal room
  - Description: At `≤700px` the todo rows currently sit only 6px from the viewport edges (`#toDoChild { margin: 4px 6px; ... }`), so titles read as hugging the screen. Raise the lateral row margin to **14px** on each side and add `env(safe-area-inset-left/right, 0px)` on top so landscape and notched devices get additional inset beyond the base value. Apply the same horizontal inset to the top "+ Add a task" empty-input row inside `#mainList` so it aligns with the rows beneath it (the input is the first row of `#mainList` — match via row-level padding rather than per-element margin so the swipe-action panes still extend the full width of each `#toDoChild`). To partially offset the title room lost to the wider gutter, drop `#toDoInput` from its current mobile size to **15px** at the `≤700px` breakpoint (keep the `!important` since inline styles in `main.js` would otherwise override it). 15px is below the 16px iOS-Safari zoom-avoidance threshold for *focused* inputs, but `#toDoInput` is rendered with the `.toDoTitleDisplay` span on top while not focused on mobile (focus is a deliberate two-tap edit gesture); confirm focused editing on iOS Safari doesn't auto-zoom — if it does, fall back to keeping `#toDoInput` at 16px and shrink only `.toDoTitleDisplay` to 15px instead, which is purely visual and not subject to the input-zoom rule. Desktop spacing and font sizes stay unchanged.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
