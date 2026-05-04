# TODO List

## Bugs

- [x] **[MEDIUM]** Replace project/todo focus shortcuts with left/right arrow navigation
  - Description: Simplify the keyboard model for moving between the projects rail and the todo list. Remove the existing Ctrl+\ binding (focuses task input) and the \ project↔input toggle (both from the earlier "Ctrl+\ in empty state and \ as toggle" entry — supersedes it). In their place, add ArrowLeft to focus the active project rail icon and ArrowRight to focus the visible task input (#addTaskInput or #emptyStateInput, whichever is rendered). Both bindings must ignore keydown when focus is already inside an editable input/textarea so arrow keys still move the caret while typing — the shortcut only fires when focus is on the body, on a project rail icon, or on a non-editable element. Update the `Ctrl + \` hint pill in the task input row to reflect the new model (e.g., remove it, or replace with a subtle "← →" affordance). The Ctrl+Backspace sidebar toggle and the rest of the keyboard suite stay as-is. Use grep + offset/limit when navigating main.js for the existing Ctrl+\ and \ handlers to remove.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-04

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
