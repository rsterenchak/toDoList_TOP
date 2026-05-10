# TODO List

## Bugs

- [x] **[MEDIUM]** Fix ArrowDown from sidebarToggle landing on first todo instead of first project
  - Description: Pressing ArrowDown while focused on `sidebarToggle` moves focus to the first todo row in the main panel instead of the first project (`projChild`) in the sidebar. Expected behavior is the spatial inverse of the existing ArrowUp transition (top project → sidebarToggle): from sidebarToggle, ArrowDown should focus the first `projChild` in the sidebar, since the sidebar sits directly below the toggle. Likely cause is the ArrowDown handler on `sidebarToggle` either targeting the wrong element (querying the todo list rather than the project list) or being absent entirely so default Tab-style focus order takes over and lands on the first focusable element after the toggle in DOM order.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-05-10

## Features

- [x] **[MEDIUM]** Add keyboard navigation within todo row sub-controls
  - Description: A todo row's sub-controls (checkbox, title, due-date pill, expand caret, delete X, expanded description) aren't all reachable from the keyboard today — Tab order skips most of them and Enter doesn't consistently activate the focused control, so the row can't be driven without a mouse. Make every sub-control tabbable in visual order and Enter-activatable, including the description when the row is expanded, and wire arrow-key + Enter editing inside the due-date popover so dates can also be set entirely from the keyboard.
  - Behavior:
    1. Tab into a todo row focuses the checkbox first; Shift+Tab from the next row's checkbox returns to the previous row's last sub-control (delete X if collapsed, description if expanded).
    2. Within a collapsed row, Tab steps in visual order: checkbox → title → date pill → expand caret → delete X. Shift+Tab reverses.
    3. Within an expanded row, Tab order extends to include the description after delete X: checkbox → title → date pill → expand caret → delete X → description. Shift+Tab reverses.
    4. Checkbox focused, Enter → toggles completed state via the existing handler.
    5. Title focused, Enter → enters the existing inline-edit mode; Enter again commits, Escape cancels.
    6. Date pill focused, Enter → opens the due-date popover. Inside the popover, arrow keys move the highlighted day; Enter applies that date and closes the popover; **Backspace cancels and closes without changing the date**.
    7. Expand caret focused, Enter → toggles the row's expanded/collapsed state. When collapsing, focus returns to the caret; when expanding, focus stays on the caret so Tab steps naturally into the new description.
    8. Delete X focused, Enter → triggers the existing delete flow (including any confirmation already present).
    9. Description focused, Enter → enters inline-edit mode for the description body; Enter again commits, Escape cancels. Only available while the row is expanded.
    10. The existing `:focus-visible` ring shows the active sub-control at every step.
  - Implementation notes:
    - Audit each sub-control for `tabindex`. Native buttons are already tabbable; non-button elements (title span, date pill if it's a `div`, description container) likely need `tabindex="0"`.
    - The description's `tabindex` should toggle with the row's expanded state — `tabindex="0"` when expanded, `tabindex="-1"` (or removed) when collapsed — so it's not in the Tab order while hidden.
    - Add `keydown` listeners checking `e.key === 'Enter'` on each non-button sub-control, calling the same handler the existing click invokes. For the date popover, also listen for `Backspace` to close-without-apply. `e.preventDefault()` where Enter would otherwise insert a newline (notably if title or description edit uses contenteditable/textarea).
    - The four row builders (`addInitialToDo`, `regenToDos`, `appendNewToDoRow`, `addToDos_restore`) all need the same wiring — fold the new keyboard handlers into a shared helper called from all four rather than duplicating, so freshly created, mid-session, Enter-chained, and restored-on-refresh rows all behave identically.
    - The date popover may already support arrow-key navigation internally — verify with grep before adding; if so, only wire the Enter-to-open, Enter-to-apply, and Backspace-to-cancel transitions.
    - `main.js` is over 25k tokens — locate the row builders, expand-caret handler, and date popover with grep + offset/limit, never a full read.
  - Acceptance criteria:
    - Every sub-control (including description when expanded) is reachable via Tab in visual order on freshly created rows, restored rows, rows reached via Enter chaining, and rows in any project.
    - Enter activates the focused sub-control's primary action consistently across all rows.
    - Backspace inside the open date popover closes it without modifying the date; outside the popover, Backspace retains its normal browser behavior (no global hijack).
    - Description tabindex updates correctly as rows are expanded and collapsed.
    - No regression in mouse/touch interaction; no regression in existing project-row keyboard behavior; no regression in the date popover's mouse flow.
    - Inline title edit, inline description edit, date popover apply/cancel, expand toggle, and delete confirmation behave identically to their mouse equivalents.
  - Out of scope: roving-tabindex refactor, keyboard equivalent of swipe-to-delete, multi-row keyboard selection, drag-and-drop reordering via keyboard.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-10

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
