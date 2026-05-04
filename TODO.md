# TODO List

## Bugs

- [ ] **[MEDIUM]** Add Ctrl+Backspace shortcut to toggle the sidebar
  - Description: Bind Ctrl+Backspace globally as a toggle for the sidebar's collapsed (icon rail) and expanded (full sidebar with project names + add button) states — the same toggle the hamburger button performs. Shortcut should preventDefault so the browser's "go back" behavior doesn't fire, and should ignore the keydown when focus is inside an editable input/textarea so Ctrl+Backspace can still delete the previous word in task titles. Pairs with the existing keyboard-driven workflow (Ctrl+\ for the task input, \ for project↔input toggle) and lets users navigate the entire chrome without reaching for the mouse. Use grep + offset/limit when navigating main.js to locate the hamburger toggle handler.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Build help modal triggered by ? key, the help button, and the ghost menu
  - Description: Create a modal explaining the app's chrome — topic-based sections for Tasks, Projects, the ghost menu, and Keyboard Shortcuts (rendered as a two-column table with monospace key-cap pills). Each section is a key for visible UI elements ("click rail icons to switch projects, hover for full names") rather than abstract documentation. Three triggers: the existing "?" button in the bottom-right, a global ? keypress, and a new "Help" item in the ghost menu. Modal closes three ways per the project standard: explicit close button, backdrop click, and Escape. Style matches the Void aesthetic — dark surface, purple uppercase letter-spaced section labels, the same key-cap pill treatment used elsewhere. Use grep + offset/limit when navigating main.js for existing modal infrastructure to mirror.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-04
     
- [ ] **[LOW]** Add last-exported JSON timestamp to footer
  - Description: Track the timestamp of the most recent manual JSON export and display it in the footer next to "X OPEN Y DONE" — formatted as relative time ("exported 3 days ago") so the indicator ages into a soft backup-reminder as the gap grows. Persist the timestamp in localStorage under a new key (e.g., `todoapp_lastExport`) and update it whenever the user selects "Export JSON" from the ghost menu. No indicator is needed for the localStorage autosave — that's continuous and would be visibly broken if it failed; the point of this one is specifically to nudge users to back up to a real file. Optionally mirror the same text inline next to the "Export JSON" item in the ghost menu for context at the moment of action.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
