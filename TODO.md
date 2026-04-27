# TODO List

## Bugs
     
- [x] **[MEDIUM]** Extract row construction helpers from main.js into new toDoRow.js
  - Description: First of two PRs splitting the `toDoRow.js` carve-out (the last sub-task in the main.js module-split refactor). Create `toDoList_main/src/toDoRow.js` and move the row-construction layer out of `main.js`: `buildToDoRow` plus the per-row wiring helpers `wireCheckbox`, `wireDescToggle`, and `wireToDoRowClick`. Thread shared dependencies (`ensureCompanion`, `listLogic`, anything from `dueDate.js` / `dragDrop.js`) via plain ES imports, matching the precedent set by `projectRow.js`. Leave the DOM-lifecycle functions (`attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, `focusBlankToDoInput*`) in `main.js` for the follow-up entry.
  - Implementation notes: an earlier attempt to extract `toDoRow.js` in one shot hit an API stream-idle timeout mid-`create_file` (~400-line file, long agentic session). Splitting the carve-out in half keeps each tool call short enough to land cleanly. `main.js` is over 25k tokens — investigate with grep + `offset`/`limit`, never read it in full.
  - Acceptance criteria: all behavior preserved (checkbox toggle, description expand/collapse, row click, due-date pill, etc.); existing tests pass; any test under `toDoList_main/tests/` that reads `main.js` as a string and greps for one of the moved function names gets repointed at `toDoRow.js`. No new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/`
  - Completed: 2026-04-27 (PR #<number>)

- [ ] **[MEDIUM]** Move toDo DOM-lifecycle functions from main.js into toDoRow.js
  - Description: Second of two PRs completing the `toDoRow.js` carve-out. After the row-construction extraction lands, move the remaining toDo-row functions out of `main.js` and into the existing `toDoRow.js`: `attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, and the `focusBlankToDoInput*` helpers. With this merged, `main.js` is reduced to its final shell — `component()`, `restoreFromStorage()`, the bulk-description toolbar wiring, and imports — completing the module-split refactor end-to-end.
  - Implementation notes: depends on the previous entry being merged first. `main.js` is over 25k tokens — investigate with grep + `offset`/`limit`. If the move is still close to the stream-timeout threshold, do it as a stub-then-`str_replace` flow (create the export skeleton first, then move functions in 2 batches) rather than one giant `create_file`.
  - Acceptance criteria: drag-and-drop (mouse and touch), reorder persistence through `listLogic`, append-on-add behavior, and blank-input focus all work identically; existing tests pass; `main.js` line count drops to roughly the projected ~400 lines; any tests grepping `main.js` for the moved function names get repointed at `toDoRow.js`. No new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Add toggle for visual truncation of long todo titles
  - Description: Long todo titles currently overflow or wrap awkwardly inside their row. Add a display-only truncation that trims the rendered title to a single line with a trailing ellipsis (CSS `text-overflow: ellipsis` with `white-space: nowrap` and `overflow: hidden` on the title container is the cleanest path); the full title is preserved in the underlying data and revealed on hover (native `title` attribute tooltip) and inside the edit modal. Add a small icon button in the TODO ITEMS header row, immediately to the left of the existing "Expand all" control, using a stacked-lines glyph (three horizontal lines, each shorter than the last) and a "Compact titles" tooltip on hover. Toggle has two visual states: outline (off) and filled background using the existing accent color (on). Persist the on/off state in `localStorage` alongside the existing theme preference so it survives reloads — the preference is global, not per-project. No changes to stored todo data, no new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-26 (PR #<number>)

- [x] **[LOW]** Add periodic blinking animation to ghost companion sprite
  - Description: Extend the ghost companion in `companion.js` so it blinks on its own at irregular intervals while idle (in addition to whatever animations it already does). Pick a randomized cadence — roughly every 3–6 seconds with a short ~120ms closed-eye frame — so the blink reads as natural rather than metronomic. Reuse whatever frame-swap or sprite-state mechanism the existing animations use; don't introduce a new animation system. Make sure the blink timer pauses or resets when the ghost is in another animated state (e.g. reacting, moving) so blinks don't visibly clip mid-action.
  - File: `toDoList_main/src/companion.js`
  - Completed: 2026-04-26 (PR #<number>)

- [x] **[LOW]** Replace dark-mode toggle with sun/moon icon button
  - Description: Swap the current dark-mode toggle for a 36×36 icon button placed immediately to the right of the ghost toggle. The button shows a moon glyph in light mode and a sun glyph in dark mode (icon represents the target mode, per convention), with a short fade/rotate (~150ms) on the swap to match existing app transitions. Use inline SVG for both glyphs — no new icon-library dependency — and update `style.css` for the button frame (transparent fill, subtle border, hover state). Existing theme-toggle wiring lives in `main.js`; grep with `offset`/`limit` rather than loading the whole file since it's over 25k tokens.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-25 (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
