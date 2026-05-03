# TODO List

## Bugs

- [x] **[MEDIUM]** Make Ctrl+\ work in the empty state and add \ as a project↔input focus toggle
  - Description: Two related shortcut changes. First, the existing Ctrl+\ handler focuses #addTaskInput but does nothing when the empty state is visible — make it context-aware so it focuses whichever task input is currently rendered (#addTaskInput or #emptyStateInput). Second, add a \ (no modifier) shortcut that toggles focus between the active project's rail icon and the visible task input: pressing \ from the rail icon moves focus to the input; pressing \ while in the input intercepts the keydown with preventDefault (so the character isn't typed) and moves focus back to the rail icon. The active rail icon may need tabindex=0 to be focusable. One tradeoff to flag: always intercepting \ in the input means users can't type a literal backslash in task titles — acceptable since backslashes are vanishingly rare in task names, but worth confirming. Use grep + offset/limit when navigating main.js for the existing Ctrl+\ wiring to mirror.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-03

- [ ] **[MEDIUM]** Repurpose Ctrl+Enter to expand all descriptions instead of the completed section
  - Description: Currently Ctrl+Enter expands the "Completed (N)" collapsed section at the bottom of the list. Repurpose it to mirror the EXPAND ALL button instead — toggling expanded descriptions on all open tasks inline, since that's a higher-frequency action than viewing completed items. The Completed section stays accessible via its chevron header and doesn't need a dedicated shortcut. Implementation is a single binding swap: point the Ctrl+Enter listener at the same handler EXPAND ALL invokes. Use grep + offset/limit when navigating main.js to locate both bindings.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[LOW]** Align ghost menu trigger with hamburger in the top row
  - Description: Currently the ghost button sits alone in a top zone above the hamburger and breadcrumb row, leaving a half-empty band of chrome at the top. Move the ghost button up to share the top row with the hamburger so both global controls (hamburger left, ghost right) sit on the same horizontal band. The breadcrumb row below — active project name, count, and EXPAND ALL — then reads as a clean second row of project-scoped chrome. Pure positioning change, no functional impact on the menu, hover-pulse, or any other ghost behavior. Likely a flexbox/grid adjustment in the top chrome container.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [ ] **[MEDIUM]** Build help modal triggered by ? key, the help button, and the ghost menu
  - Description: Create a modal explaining the app's chrome — topic-based sections for Tasks, Projects, the ghost menu, and Keyboard Shortcuts (rendered as a two-column table with monospace key-cap pills). Each section is a key for visible UI elements ("click rail icons to switch projects, hover for full names") rather than abstract documentation. Three triggers: the existing "?" button in the bottom-right, a global ? keypress, and a new "Help" item in the ghost menu. Modal closes three ways per the project standard: explicit close button, backdrop click, and Escape. Style matches the Void aesthetic — dark surface, purple uppercase letter-spaced section labels, the same key-cap pill treatment used elsewhere. Use grep + offset/limit when navigating main.js for existing modal infrastructure to mirror.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[LOW]** Add last-exported JSON timestamp to footer
  - Description: Track the timestamp of the most recent manual JSON export and display it in the footer next to "X OPEN Y DONE" — formatted as relative time ("exported 3 days ago") so the indicator ages into a soft backup-reminder as the gap grows. Persist the timestamp in localStorage under a new key (e.g., `todoapp_lastExport`) and update it whenever the user selects "Export JSON" from the ghost menu. No indicator is needed for the localStorage autosave — that's continuous and would be visibly broken if it failed; the point of this one is specifically to nudge users to back up to a real file. Optionally mirror the same text inline next to the "Export JSON" item in the ghost menu for context at the moment of action.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
