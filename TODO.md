# TODO List

## Bugs

- [ ] **[MEDIUM]** Fix Delete key targeting first todo instead of selected project
  - Description: After clicking a project in the sidebar (or opening its context menu), pressing the Delete key prompts to delete the first todo in the active list instead of the project itself. Expected behavior is that Delete on a focused/selected project triggers the project-deletion confirmation flow (same as the context menu's Delete action), and only routes to todo deletion when a todo row is the current focus target. Likely cause is a global `keydown` handler in `main.js` whose Delete branch unconditionally targets todos — gate it on what's currently focused/selected (project row vs. todo row) before deciding which deletion path to fire. `main.js` is over 25k tokens, so grep for the Delete-key handler with `offset`/`limit` rather than reading the whole file. Confirmation copy should name the project being deleted and note that its todos will also be removed, per the destructive-action rule in `CLAUDE.md`.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[MEDIUM]** Apply todo-active focus to neighbor after todo deletion
  - Description: When a todo item is deleted, the `todo-active` class isn't reliably moved to an adjacent row, leaving the list with no active/focused todo until the user clicks one. Expected behavior is that on deletion the active state shifts to the next todo below the deleted one, falling back to the previous todo if the deleted item was last, and clearing only when the list is empty — keeping a visible anchor for keyboard navigation and arrow-key flow. Likely cause is the deletion handler in `main.js` re-rendering the list without restoring `todo-active` on a sibling; capture the deleted row's index before removal and re-apply the class to the row now occupying that index (or `length - 1` if past the end). `main.js` is over 25k tokens, so grep for the deletion handler and `todo-active` references with `offset`/`limit` rather than reading the whole file.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Apply focus and arrow-key navigation to delete confirmation modal buttons
  - Description: When the delete confirmation modal opens (for either todo item or project deletion), neither the Cancel nor Delete button receives focus, so keyboard users have to reach for the mouse to dismiss or confirm. Expected behavior is that focus lands on Cancel by default when the modal opens (safer default for a destructive action), Left/Right arrow keys move focus between Cancel and Delete, Enter activates the focused button, and Escape closes the modal as it already does. Tab should also cycle between the two buttons and stay trapped within the modal while it's open. Likely changes are in the modal-open handler in `main.js` — grep for the delete-confirmation modal show function with `offset`/`limit` since `main.js` is over 25k tokens, then call `.focus()` on the Cancel button after the modal becomes visible and add a `keydown` listener for arrow keys scoped to the modal. Add or verify a `:focus-visible` style in `style.css` so the focused button is clearly distinguishable from the unfocused one.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
         
- [ ] **[LOW]** Make projButton reachable via down-arrow from last project and Enter to activate
  - Description: Extend the existing project arrow-key navigation so pressing Down on the last project moves focus to the "+" project button at the bottom of the sidebar, and pressing Enter while it's focused triggers the new-project creation flow (same as clicking it). Up-arrow from the projButton should return focus to the last project. This rounds out keyboard navigation so users can add a project without reaching for the mouse. Likely changes are in `main.js` — find the existing project-row keydown handler (grep for the arrow-key branch with `offset`/`limit`, since `main.js` is over 25k tokens) and have its Down branch fall through to the projButton when there's no next project, plus wire a `keydown` listener on the projButton itself for Enter/Up. Add a visible `:focus-visible` style for the projButton in `style.css` matching the existing focus treatment on project rows so the focus state is clear.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Build help modal triggered by ? key, the help button, and the ghost menu
  - Description: Create a modal explaining the app's chrome — topic-based sections for Tasks, Projects, the ghost menu, and Keyboard Shortcuts (rendered as a two-column table with monospace key-cap pills). Each section is a key for visible UI elements ("click rail icons to switch projects, hover for full names") rather than abstract documentation. Three triggers: the existing "?" button in the bottom-right, a global ? keypress, and a new "Help" item in the ghost menu. Modal closes three ways per the project standard: explicit close button, backdrop click, and Escape. Style matches the Void aesthetic — dark surface, purple uppercase letter-spaced section labels, the same key-cap pill treatment used elsewhere. Use grep + offset/limit when navigating main.js for existing modal infrastructure to mirror.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-04
     
- [x] **[LOW]** Add last-exported JSON timestamp to footer
  - Description: Track the timestamp of the most recent manual JSON export and display it in the footer next to "X OPEN Y DONE" — formatted as relative time ("exported 3 days ago") so the indicator ages into a soft backup-reminder as the gap grows. Persist the timestamp in localStorage under a new key (e.g., `todoapp_lastExport`) and update it whenever the user selects "Export JSON" from the ghost menu. No indicator is needed for the localStorage autosave — that's continuous and would be visibly broken if it failed; the point of this one is specifically to nudge users to back up to a real file. Optionally mirror the same text inline next to the "Export JSON" item in the ghost menu for context at the moment of action.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-04

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
