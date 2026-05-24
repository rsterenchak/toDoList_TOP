# TODO List

## Bugs

- [x] **[MEDIUM]** Add regression test pinning that listLogic.js never references `todos.user_id`
  - Description: The `todos` table intentionally has no `user_id` column — RLS on todos uses a sub-select against the parent project to enforce per-user access, and Phase 5's schema makes this explicit. Despite this, three separate PR iterations have re-introduced `user_id` references against the todos table (in hydrateFromSupabase's `.eq('user_id', ...)` filter, twice; and now in persistMutation's insert branch's row payload). Each surfaces as a PGRST204 "Could not find the 'user_id' column of 'todos' in the schema cache" error at runtime. The pattern is automation-driven — readers reasonably assume every row needs user_id, miss the projects-side RLS sub-select, and add the reference. Add a regression test at `tests/listLogicSchema.test.js` that grep-asserts `listLogic.js` source contains zero occurrences of `'user_id'` within a 200-character window of `'todos'` (string-based static check, not a runtime test — fast and deterministic). Implementation: read `listLogic.js` as a string via `fs.readFileSync`, scan with a regex like `/['"]todos['"][\s\S]{0,200}['"]user_id['"]/` and `/['"]user_id['"][\s\S]{0,200}['"]todos['"]/`, assert both match zero times. Also add an inline comment at the top of persistMutation's insert branch and update branch and at hydrateFromSupabase's todos query saying explicitly "DO NOT add user_id to todos queries or payloads — see tests/listLogicSchema.test.js". The comment + the failing test together should make the regression impossible going forward.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogicSchema.test.js`
  - Completed: 2026-05-24

## Features

- [ ] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
