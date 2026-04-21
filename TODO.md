# TODO List

## Bugs

- [x] **[HIGH]** Fix font size growing on todo items after deletion
  - Description: When a todo item is deleted, the font size of the remaining items increases. Expected behavior: font size stays constant regardless of how many items are added or removed. Likely cause is a CSS rule using a relative/viewport unit (vh, vw, %) on the list or items that recalculates as the list shrinks, or a JS handler that re-applies sizing on delete. Investigate both the stylesheet and the delete handler.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-19 (PR #4)

- [ ] **[MEDIUM]** Hide due date field on blank placeholder todo row
  - Description: The blank "new item" placeholder row pinned at the top of each project's list shows the "Due: MM/DD/YYYY" field even though no item exists yet, creating unnecessary visual noise next to an empty title input. Hide both `dateText` and `dueInput` when `item.tit` is empty (matching the existing pattern for `checkToDo`, `descToggle`, and `closeButtonToDo`, which already set `style.display = "none"` on blank rows), then reveal them inside the `toDoInput` keydown Enter handler alongside the other controls that get unhidden on first commit. Hiding is preferred over removing so `wireDateInputs` and `setDueDatePlaceholders` can still wire and pre-fill the inputs normally — they just stay invisible until the row is committed.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Fix todo description not saving when cleared via backspace and persisting stale value on reopen
  - Description: When a user backspaces a todo item's description down to empty and clicks away, the empty value is never persisted — reopening the description panel re-displays the previous (deleted) text because `item.desc` still holds the old string. Pressing Enter on an empty description also fails: it just paints the input with a solid red border and refuses to commit. Expected behavior: an empty description should be a valid, saveable state (clearing a description is a legitimate user action), persisting on both blur and Enter, and reopening the panel should reflect the cleared value. Root cause is in `buildToDoRow` in `main.js`: the `descInput` keyup handler only writes to `item.desc` when `val.length > 0`, the keydown Enter handler treats empty as an error (red border, no save) instead of as a clear, and there is no blur handler at all — so click-away never persists. Fix by removing the length guards so empty strings save normally, dropping the red-border rejection on Enter, and adding a blur listener on `descInput` that mirrors the keyup save path. Match the pattern already used by the title input's keyup/blur save flow for consistency.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Fix todo reorder not persisting across re-renders (e.g. switching projects)
  - Description: After dragging a todo item to a new position within a project, the new order is reflected visually but is lost the next time the project is re-rendered (switching to another project and back, or reloading). The DOM appears to update correctly on drop, but the underlying array order doesn't match what the user sees, so any subsequent rebuild from the data model snaps back to a stale (or scrambled) order. Root cause is an index-space mismatch between the drag layer and the model. In `attachToDoDrag` (in `main.js`), `fromIdx`/`toIdx` are computed via `draggableSiblings`, which filters out the non-draggable blank placeholder pinned at index 0 — so those indexes are zero-based within the *draggable* todos only. But `reorderToDo` in `listLogic.js` splices directly into the full project array which *includes* the blank at index 0, so every reorder is effectively off-by-one and operates on the wrong items. The visual move looks right because `onReorder` also moves the DOM nodes in-place using the same draggable-filtered siblings, but the persisted model is wrong; once `sortCompletedInPlace` re-runs on the next render it surfaces the mismatch. Fix by reconciling the two index spaces: either (a) translate draggable indexes to full-array indexes before calling `reorderToDo` (offset by the blank's position), or (b) make `reorderToDo` itself operate on the non-blank slice and rebuild the array with the blank pinned at index 0 — the latter is cleaner and keeps the placeholder invariant centralized in `listLogic.js`. Verify by reordering, switching projects, switching back, and reloading; the order should match the final drop position in all three cases.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Fix Enter on committed todo creating extra blank row instead of focusing existing placeholder
  - Description: When Enter is pressed inside a todo row that has already been committed (the row has a title), an additional empty placeholder row is created instead of focus simply moving to the existing blank placeholder pinned at index 0. Expected behavior: a re-commit should be a no-op for list structure — it should blur the current input and shift focus to the existing blank row at the top of the list. A new blank should only be spawned when the user is committing the row that *was* the blank placeholder. Likely root cause: the `toDoInput` keydown Enter handler in `buildToDoRow` (in `main.js`) doesn't distinguish first-commit from re-commit — it always calls `appendNewToDoRow`, which runs `sortCompletedToBottom` + `reorderToDoDOM` on every Enter. Fix by capturing the row's committed state at focus-time (the existing `savedTitle` variable already tracks this — `savedTitle === ""` means we're committing the blank, otherwise we're re-editing) and on re-commit, skip the rebuild path entirely: just blur and call a focus-only helper that finds the existing blank `#toDoInput` and focuses it without touching the model or DOM structure.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Fix drag-and-drop reordering breaking completed-items-at-bottom invariant
  - Description: Drag-and-drop currently lets the user drop an uncompleted todo below a completed one, or drag a completed item up among uncompleted ones, breaking the invariant that completed items always sit at the bottom of the list (an invariant the rest of the system — `sortCompletedInPlace`, `sortCompletedToBottom`, the checkbox handler, restore-from-storage — actively maintains). After drop the new order persists to localStorage and survives reloads. Fix in either `reorderToDo` (re-run `sortCompletedInPlace` after the splice and have the DOM-move logic in `attachToDoDrag.onReorder` re-render from the model instead of moving the dragged node in-place), or by clamping `toIdx` in `setupRowDrag.computeDropIndex` to the uncompleted/completed boundary so completed rows can only reorder among themselves and uncompleted rows can only reorder above the first completed row. The model-side fix is more robust since it also covers any future reorder caller.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[LOW]** Remove unused grey buttons from top-right of header
  - Description: Two small grey circular buttons sit in the top-right corner of the header (visible alongside the hamburger menu on the left and the "PROJECTS" / "TODO ITEMS" column labels below). They were an early design placeholder that never got wired up to any functionality. Remove the markup for both buttons and any associated CSS rules. Verify no event handlers or references to them exist in the JS files; if any are found, remove those too.
  - File: `toDoList_main/src/index.js`, `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-04-19

## Features

- [x] **[HIGH]** Add description box toggle
  - Description: Add a drop down toggle to each toDo list item instead of needing to click directly on the item itself to open the description
  - File: `toDoList_main/src/style.css/`, `toDoList_main/src/main.js/`, `toDoList_main/src/index.js/`, `toDoList_main/src/toDo.js/`
  - Completed: 2026-04-18 (PR #3)

- [x] **[MEDIUM]** Add check-off feature for todo items
  - Description: Add a checkbox to the left of each todo item. Clicking it marks the item as completed: visually indicate completion with a strikethrough and muted text color, but keep the item in the list rather than removing it. Clicking again un-completes it. Persist the completed state on each item in the data model (likely a `completed: boolean` field on items in `listLogic.js`) so the state survives reloads alongside however items are currently stored.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/style.css`, `toDoList_main/src/index.js`
  - Completed: 2026-04-19

- [x] **[MEDIUM]** Replace project delete button with right-click context menu (edit + delete)
  - Description: Remove the existing `×` delete button that appears on each project in the sidebar (both the markup and any associated CSS and event handlers). Replace it with a custom context menu that appears on right-click of a project, positioned at the cursor. The menu contains two options: "Edit" (opens the existing project rename/edit flow) and "Delete" (removes the project, with a confirmation step before deletion; if the project contains todos, the confirmation should mention how many items will be lost). Suppress the browser's default right-click menu on project elements only, not globally. The custom menu should close on: selecting an option, clicking outside the menu, pressing Escape, or right-clicking elsewhere. Style it to match the existing dark theme. Note: right-click is desktop-only — add a long-press handler (roughly 500ms) on touch devices that opens the same menu, so mobile users retain access to edit/delete. Scope this feature to projects only; todo items are out of scope.
  - File: `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-2

- [x] **[MEDIUM]** Add drag-and-drop reordering for projects and todo items
  - Description: Allow users to reorder both projects in the sidebar and todo items within the currently selected project by dragging them into a new position. Implement both behaviors in a single consistent pattern so they look and feel the same. On drag start, the element being dragged should have a visual indicator (reduced opacity or subtle lift/shadow). As the user drags over other elements, show a drop indicator (a horizontal line or highlighted gap) at the target insertion point. On drop, the list reorders and the new order persists so it survives reloads — save the updated order in the data model (likely in `listLogic.js`) for both projects and per-project todo item arrays. Use the native HTML5 drag-and-drop API rather than adding a new library. If either list overflows vertically, auto-scroll when the user drags near its top or bottom edge. On mobile/touch devices, add touch event handlers (touchstart/touchmove/touchend) so the feature works on touch as well as mouse. Scope: projects can only be reordered among projects, and todo items can only be reordered within their current project — dragging todo items between projects is out of scope. Where possible, share the drag-and-drop logic between the two contexts (e.g., a single reusable handler or helper) rather than duplicating code.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-20

- [x] **[MEDIUM]** Auto-sort completed todo items to bottom of list
  - Description: When a user checks off a todo item, automatically move it beneath all uncompleted items in the same project; unchecking moves it back above the completed block, preserving relative order within each group. Apply the same sort on initial render so reopening a project shows completed items already grouped at the bottom, and keep the trailing blank placeholder row as the very last entry (the invariant `addToDo`/`removeToDo` maintain). Add the reorder helper in `listLogic.js` alongside `reorderToDo` and persist via `saveToStorage`; the DOM update in `wireCheckbox` should move the row in-place (matching the pattern in `attachToDoDrag`) so event listeners and any open `descSibling` panel travel with the row.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-20

- [ ] **[LOW]** Implement light mode
  - Description: Add a theme toggle in the top-right of the header using a sun/moon icon button (the dominant pattern in modern web apps). Clicking swaps between dark and light themes. Default to dark mode on first load, and persist the user's choice in localStorage so it survives reloads and return visits. The light theme should be a soft, dimmed off-white — closer to a low-brightness night-reading palette than a bright paper-white — to reduce contrast with the existing dark theme's aesthetic.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[LOW]** Add changelog button to todo list app
  - Description: Add a changelog button to the header (icon-based, with a "Changelog" tooltip on hover) that opens a modal displaying version history when clicked. Create a new `toDoList_main/src/changelog.js` file that exports a hardcoded array of changelog entries; each entry has a version string, a date, and categorized bullet lists (Added / Fixed / Changed, following the Keep a Changelog convention). The modal renders these entries newest-first, with version and date as the heading for each block. Include a close button (X in the corner) and support closing via the Escape key and clicking the backdrop. Style the modal to match the existing dark theme. Seed the file with one placeholder entry so the modal has something to show on first render.
  - File: `toDoList_main/src/changelog.js`, `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
