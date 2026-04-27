# TODO List

## Bugs
     
- [ ] **[MEDIUM]** Split main.js into focused sibling modules
  - Description: Refactor `main.js` (currently over 25k tokens, by far the largest source file — can't be read in full without grep + offset/limit) into ~9 focused sibling modules under `toDoList_main/src/`, leaving `main.js` as a thin shell containing only `component()`, `restoreFromStorage()`, the bulk-description toolbar wiring, and imports. No behavior changes — pure reorganization. Shared dependencies (`ensureCompanion` accessor, `listLogic`) thread through via plain ES imports.
  - Proposed split:
    1. `theme.js` — `THEME_KEY`, `applyTheme`, `resolveInitialTheme`, `getCurrentTheme`, toggle SVGs, click handler factory (~50 lines)
    2. `dueDate.js` — `daysUntilDue`, `applyDueUrgency`, `setItemDue`, `setRowDateOffset`, `parseItemDue`, `formatPillAbsolute`, `updateDuePillLabel`, calendar SVGs, `showDueDatePopover` / `hideDueDatePopover` / `renderDuePopoverBody` / `shiftDueFocus` / `onDuePopoverOutsideClick` / `onDuePopoverKeydown` (~250 lines)
    3. `dragDrop.js` — `setupRowDrag`, `getDropIndicator`, `removeDropIndicator`, `draggableSiblings`, `computeDropIndex`, `showDropIndicator`, `autoScrollIfNeeded`, swipe constants, `resetSwipeRow` (~200 lines)
    4. `modals.js` — `showConfirmModal`, `showChangelogModal`, changelog-seen helpers, `notifyUpdateAvailable`, `applyPendingUpdate`, `updateChangelogDot` (~150 lines)
    5. `projectMenu.js` — `showProjectContextMenu`, `hideProjectContextMenu`, `buildColorPicker`, outside-click/keydown listeners, `PROJECT_COLOR_HEX`, `applyProjectAccent` (~120 lines)
    6. `emptyState.js` — `updateEmptyState`, `updateCompletedSection`, completed-section persistence helpers (~150 lines)
    7. `prefs.js` — centralized `localStorage` getters/setters: compact titles, completed section, sidebar width, changelog last-seen. Consolidating storage keys here makes the persisted surface auditable in one place (~50 lines)
    8. `toDoRow.js` — `buildToDoRow`, `wireCheckbox`, `wireDescToggle`, `wireToDoRowClick`, `attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, `focusBlankToDoInput*` (~400 lines)
    9. `projectRow.js` — `attachProjectContextMenu`, `attachProjectDrag`, `reorderProjectDOM`, `deleteProjectFlow`, `countRealToDos` (~250 lines)
  - Acceptance criteria:
    - All current behavior preserved — checkboxes, drag/drop (mouse and touch), swipe-to-delete, due-date popover, theme toggle, project context menu, modals, completed section, update notification, etc.
    - `main.js` shrinks to roughly 400 lines.
    - All existing tests pass; any test under `toDoList_main/tests/` that reads `main.js` as a string and greps for function names gets repointed at the appropriate new module.
    - No new dependencies — pure module split.
  - Implementation notes: extract one module at a time, each as its own PR, so any regression bisects cleanly. Order suggestion (smallest/most isolated first): `prefs.js` → `theme.js` → `modals.js` → `emptyState.js` → `projectMenu.js` → `dragDrop.js` → `dueDate.js` → `projectRow.js` → `toDoRow.js`. When investigating `main.js` to plan each carve-out, use grep + `offset`/`limit` rather than a full read.
  - Progress (one PR per module — pick the next unchecked one):
    - [x] `prefs.js`
    - [x] `theme.js`
    - [x] `modals.js`
    - [x] `emptyState.js`
    - [x] `projectMenu.js`
    - [x] `dragDrop.js`
    - [x] `dueDate.js`
    - [ ] `projectRow.js`
    - [ ] `toDoRow.js`
  - Out of scope: any behavior changes, new features, or fixes; reorganizing `listLogic.js`; renaming public APIs; converting any of the new modules to classes or factories.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/theme.js`, `toDoList_main/src/dueDate.js`, `toDoList_main/src/dragDrop.js`, `toDoList_main/src/modals.js`, `toDoList_main/src/projectMenu.js`, `toDoList_main/src/emptyState.js`, `toDoList_main/src/prefs.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/src/projectRow.js`, `toDoList_main/tests/`
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
