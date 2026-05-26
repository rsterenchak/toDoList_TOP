# TODO List

## Bugs

- [ ] **[LOW]** Add center-screen checkmark animation on mobile swipe-to-complete
  - Description: When a todo row is swiped right past the completion threshold on a touch device, briefly show a large purple checkmark animation in the center of the viewport to confirm the action. Style: a bare ✓ in the accent purple (`#6C5DF5`), roughly 90px tall, that pops in with a slight overshoot (scale 0.3 → 1.2 → 1.0) while a soft circular ripple expands outward from it and fades to transparent. No enclosing circle or background — the check sits over whatever's behind it. Total duration roughly 1.0–1.2s, then the whole thing fades out. Overlay must be `pointer-events: none` and `position: fixed` centered, so it never intercepts taps and the user can keep scrolling or tapping mid-animation. Gate the whole behavior behind the existing touch-device check (`pointer: coarse`) — desktop completion paths don't trigger it. Trigger fires on swipe-release once the completion threshold is crossed (matches the existing swipe-right-to-complete flow), not mid-swipe. Swiping right on an already-completed row to un-complete it does NOT play the animation — only the complete direction does. Respect `prefers-reduced-motion`: when set, skip the animation entirely and just complete the todo silently. Hook into the existing `touchend` handler in `main.js` that finalizes the swipe-complete gesture; the animation should be a small DOM-node-insert-then-remove rather than a long-lived element, so there's no cleanup risk if the user fires it repeatedly in quick succession.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
