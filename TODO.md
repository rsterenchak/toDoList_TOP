# TODO LIST

- [ ] **[LOW]** Keep the "Show completed (N)" overflow item on one line
  - Type: bug
  - Description: In the TODO.md viewer's overflow menu, the "Show completed (N)" item wraps its count onto a second line ("Show completed" / "(1)"). The item (`.todoMdViewerShowCompletedItem`) is a flex row of a checkmark plus the label (`.todoMdViewerShowCompletedLabel`, `flex: 1 1 auto`), and at the menu's `min-width: 150px` the checkmark + the "Show completed (N)" text exceeds the available label width; with no `white-space` rule on the label, it wraps. Fix in CSS only: add `white-space: nowrap` to `.todoMdViewerShowCompletedLabel` (or `.todoMdViewerShowCompletedItem`) so the text stays on one line — the menu is absolutely positioned with `min-width: 150px` and no max-width, so it grows to fit single-line content. If the menu doesn't widen on its own, also give `.todoMdViewerOverflowMenu` `width: max-content` (keeping the 150px floor) so it sizes to its widest item. No JS change — the label is already a single string. Confirm the longer "Hide completed (N)" state and the Clear items also stay single-line, and the menu doesn't overflow the viewport in the mobile sheet.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 20112c26-f035-4895-9d12-79bb4055448f -->
