# TODO List

## Bugs

- [ ] **[HIGH]** `editProject` silently clobbers target when renaming onto an existing project name
  - Description: Renaming project A to a name that's already taken by project B wipes all of B's todos. The current implementation does `allProjects[newProperty] = allProjects[currentProperty]` with no duplicate check — the right-hand side replaces whatever was at `newProperty`. Reproducer: create "Groceries" with a todo "Milk", create "Chores" with a todo "Vacuum", then call `listLogic.editProject('Groceries', 'Chores')`. Chores now contains Milk instead of Vacuum; Vacuum is permanently lost. The UI's Enter handler catches this during manual rename via its duplicate-name check, but the blur handler in `restoreFromStorage` has a separate check that's inconsistent with the new-project flow, and `listLogic` itself has no guard. Fix by adding a duplicate-name check inside `editProject` (return early, warn, or surface an error) so the invariant holds regardless of caller. There is a currently-failing regression test in `listLogic.test.js` under `listLogic — editProject edge cases` — `editProject does not silently clobber a project when renaming onto an existing name` — that locks this down.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** `editProject` on a nonexistent source leaves `undefined` in the data model
  - Description: Calling `editProject('Ghost', 'Real')` when "Ghost" doesn't exist sets `allProjects['Real'] = undefined` (because `allProjects['Ghost']` is undefined), then deletes the nonexistent "Ghost" key. The result: `listProjectsArray()` now includes "Real", but `listItems('Real')` returns undefined, which crashes every downstream operation that assumes items is an array (e.g. `.forEach`, `.filter`, `.some` in both `listLogic` and `main.js`). The UI layer never triggers this code path today, but any future caller or test that does will hit a confusing crash far from the source. Fix by guarding the function: if `currentProperty` doesn't exist in `allProjects`, return early with a warning. Currently-failing regression test is in `listLogic.test.js` under `listLogic — editProject edge cases` — `editProject on a nonexistent project does not leave undefined in the data model`.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Malformed localStorage data crashes the app on load
  - Description: The IIFE in `listLogic.js` runs `JSON.parse(stored_raw)` at module load time with no try/catch. If `localStorage.getItem('allProjects')` ever returns malformed JSON — because of a partial write, a browser extension, a manual DevTools edit, or a version mismatch from a future schema change — the parse throws during module initialization and the entire app fails to load with a blank screen and a console error. Reproducer: open DevTools, run `localStorage.setItem('allProjects', 'not valid json')`, then reload the page. The todo app never renders. Fix by wrapping the parse in a try/catch that, on failure, logs a warning and falls through to the "fresh start" branch (so the user loses persisted data but the app stays functional). Consider also backing up the corrupt string to a secondary key (e.g. `allProjects_backup_<timestamp>`) before falling through, so a user could recover data manually if they know what they're doing. There is a currently-failing regression test in `listLogic.test.js` under `listLogic — storage corruption resilience`, though that test relies on `vi.resetModules()` and dynamic imports and may be brittle — the fix is more important than the test staying green.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  

## Features


## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15

Template:

- [ ] **[LOW]** Add changelog button to todo list app
  - Description: 
  - File: `toDoList_main/src/changelog.js`, `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)

