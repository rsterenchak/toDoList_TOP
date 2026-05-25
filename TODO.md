# TODO List

## Bugs

- [x] **[HIGH]** Replace inline stats drawer with a modal on mobile
  - Description: After multiple attempts to make the inline `#statsSibling` drawer contain its content on phone-width viewports (≤420px) — bigger cells, single-row strip, height fixes — the drawer-in-row pattern keeps fighting both the `#mainList` grid track sizing and visual containment. Switch the mobile experience to a full-screen modal: tap the existing chart-icon button on a recurring row, and a modal opens containing the full stats payload. This sidesteps the grid-track problem entirely (modal lives outside `#mainList`) and gives the contributions grid room to render at desktop size instead of degrading to the truncated `statsFallbackStripMobile`. Desktop keeps the inline drawer unchanged. Modal contents: task title in the header with a close X, a cadence subtitle line, then the existing stat-card strip, window-toggle row, full `buildContributionsGrid` grid, `.statsMissCallout`, and missed-pill list — all reused from the current `renderDrawer()`. Close via X / backdrop / Escape per CLAUDE.md. Window selection resets to 30d on each open. Once landed, remove the dead `statsFallbackStripMobile` builder and its CSS.
  - Behavior:
    1. Viewports ≤420px: tapping chart icon opens a modal (not inline drawer) with the full stats payload.
    2. Modal uses the full `buildContributionsGrid`, not the truncated mobile strip.
    3. Modal closes via X, backdrop click, or Escape.
    4. Window selection is ephemeral — resets to 30d on reopen.
    5. Viewports >420px: inline drawer renders exactly as today.
    6. Chart-icon button unchanged (same ID, same `data-has-recurrence` gating).
    7. `statsFallbackStripMobile` builder and CSS removed.
  - Implementation notes:
    - In `wireStatsToggle`'s click handler, branch on `window.matchMedia('(max-width: 420px)').matches` — true opens a modal, false uses the existing inline insert/remove path.
    - Follow the existing modal pattern in `main.js` (changelog/help modals) for backdrop, close-X, Escape wiring, and z-index.
    - Reuse `renderDrawer()`'s children (`statsCardStrip`, `statsWindowToggle`, `buildContributionsGrid`, `statsMissCallout`, `statsMissedList`) inside the modal body — only the wrapping container changes.
    - Add a cadence subtitle line under the title: `<pattern> · ENDS <endDate || NEVER>`.
    - Delete `buildFallbackStripMobile` / `statsFallbackStripMobile` from `toDoRow.js` and `style.css`. Keep plain `buildFallbackStrip` — still used by month/year cadences on desktop.
  - Acceptance criteria:
    - 380px viewport: tap chart icon → modal opens, no inline drawer.
    - All stats elements render inside the modal's border.
    - X, backdrop, and Escape all close the modal.
    - Reopen resets window to 30d.
    - >420px: inline drawer behavior identical to before this PR.
    - `statsFallbackStripMobile` class is gone from `toDoRow.js` and `style.css`.
  - Out of scope: desktop drawer changes; contributions grid redesign; new stats beyond what `renderDrawer` already builds; persisting window selection.
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/` (new test asserting the modal-vs-drawer viewport branch + that the mobile-strip dead code is gone)
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
