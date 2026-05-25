# TODO List

## Bugs

- [ ] **[HIGH]** Replace inline stats drawer with a modal on mobile
  - Description: After three rounds of trying to make the inline `#statsSibling` drawer contain its full content on phone-width viewports (≤420px) — bigger cells, single-row strip, drawer height fixes — the drawer-in-row pattern keeps fighting both the `#mainList` grid track sizing and the visual containment of "this belongs to this row." Switch the mobile experience to a full-screen modal instead: tap the existing chart-icon button on a recurring row, the row stays put, and a modal opens showing the full stats payload. This moots the grid-track height problem (the modal lives outside `#mainList`) and gives the contributions grid enough room to render at its desktop size instead of degrading to the truncated `statsFallbackStripMobile` strip. Desktop continues to use the inline drawer as it does today — the drawer pattern works fine at ≥421px. Modal layout: centered overlay with the recurring task's title in the header, a small close X, a cadence subtitle (`DAILY · ENDS NEVER`, `WEEKLY · ENDS JAN 1`, etc.), then the full stat-card strip, window-toggle row, contributions grid (the same `buildContributionsGrid` used on desktop, NOT the mobile fallback strip), `.statsMissCallout`, and the missed-pill list. Window selection is ephemeral and resets to 30d on each open. Close vocabulary follows the existing CLAUDE.md three-way rule: an explicit X button, backdrop click, and Escape key. Tear down the existing `statsFallbackStripMobile` builder and its mobile-only CSS — once the modal lands they're dead code.
  - Behavior:
    1. On viewports ≤420px, tapping a recurring row's chart-icon button opens a centered modal (not the inline drawer) containing the full stats payload.
    2. The modal renders the full `buildContributionsGrid` contributions grid, not the truncated mobile recency strip.
    3. The modal closes via X button, backdrop click, OR Escape (matching CLAUDE.md's three-way modal close vocabulary).
    4. Window selection (14d / 30d / 90d / All) inside the modal is ephemeral — closing and reopening resets to 30d.
    5. The inline drawer continues to render unchanged on viewports >420px (desktop).
    6. The chart-icon button itself is unchanged — same icon, same `data-has-recurrence` gating, same `#statsToggle` ID.
    7. The mobile-only fallback strip (`statsFallbackStripMobile` class) and its CSS rules are removed — modal renders the full grid instead.
  - Implementation notes:
    - In `wireStatsToggle`'s click handler, branch on `window.matchMedia('(max-width: 420px)').matches`: if true, open a modal containing the drawer-render output; if false, keep the existing inline insert/remove flow.
    - Build the modal following the existing modal pattern in `main.js` (see `#changelogModal`, `#helpModal`, or similar) — same backdrop + close-X + Escape wiring, same `--modal-z` z-index family.
    - Reuse `renderDrawer()`'s existing children (`statsCardStrip`, `statsWindowToggle`, `buildContributionsGrid`, `statsMissCallout`, `statsMissedList`) — only the wrapping container changes from `#statsSibling` to the new modal body. The recurring task's title goes in the modal header so the modal makes sense out of context.
    - Add the cadence subtitle line under the title: `recurrence.pattern.toUpperCase()` + ` · ENDS ` + (endDate || `NEVER`). Use the same `.statsApproximateNote` rhythm.
    - Remove `buildFallbackStripMobile` / `statsFallbackStripMobile` from `toDoRow.js` and the corresponding mobile media-query rules from `style.css`. They were a stepping stone; the modal makes them unnecessary.
    - Keep `buildFallbackStrip` (no Mobile suffix) — it's still used by month/year cadences on desktop.
    - Mobile inputs (the window-toggle buttons) need `font-size: 16px+` per CLAUDE.md — confirm the existing `.statsWindowBtn` 11px rule doesn't apply inside the mobile modal, OR override at the modal scope. Buttons aren't text inputs, but the rule's intent (no iOS auto-zoom) should be respected.
  - Acceptance criteria:
    - 380px viewport, tap chart icon on a recurring row → modal opens, drawer does NOT inline-insert.
    - Modal contains all stats elements (cards, toggle, full grid, callout, missed-pill list) within its visual border — no overflow.
    - X / backdrop / Escape all close the modal.
    - Reopen after close → window resets to 30d.
    - >420px viewport: inline drawer behavior identical to before this PR.
    - `statsFallbackStripMobile` class is gone from both `toDoRow.js` and `style.css`.
  - Out of scope: changing desktop drawer; redesigning the contributions grid; adding new stats (per-occurrence notes, charts beyond the existing grid); persisting window selection across opens.
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/` (new test asserting modal-vs-drawer branch by viewport width, and that the mobile-strip dead code is removed)
  - Completed: YYYY-MM-DD (PR #<number>)

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
