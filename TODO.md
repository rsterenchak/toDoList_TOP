# TODO List

## Bugs

- [x] **[HIGH]** Fix font size growing on todo items after deletion
  - Description: When a todo item is deleted, the font size of the remaining items increases. Expected behavior: font size stays constant regardless of how many items are added or removed. Likely cause is a CSS rule using a relative/viewport unit (vh, vw, %) on the list or items that recalculates as the list shrinks, or a JS handler that re-applies sizing on delete. Investigate both the stylesheet and the delete handler.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-19 (PR #4)

- [x] **[MEDIUM]** Fix default due date showing 1/1/2023 instead of one week from today
  - Description: The due date field for new todo items defaults to a hardcoded 1/1/2023, which is a leftover placeholder from initial development. Change the default so that when a new todo item is created, the due date field is pre-filled with the date one week from the current date (today + 7 days), computed at the moment the item is created. The hardcoded value likely lives in either the DOM markup (a `value` attribute on the date input) or in `listLogic.js` where new items are instantiated — check both and remove the hardcoded date wherever it appears, replacing it with a dynamic calculation.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/index.js`, `toDoList_main/src/toDo.js`
  - Completed: 2026-04-19

- [x] **[MEDIUM]** Fix mobile auto-zoom when focusing todo item title input
  - Description: On mobile browsers (iOS Safari in particular, and some Android browsers), focusing the text input used to enter a todo item's title causes the page to auto-zoom in. This is the browser's built-in accessibility behavior: mobile Safari automatically zooms any input whose font-size is smaller than 16px to prevent tiny text fields from being unreadable. The fix is to ensure the todo item title input has a `font-size` of at least 16px (via CSS) on mobile viewports. Apply the fix to the input element used for entering/editing todo item titles; do not change the visual font size of the rendered todo items themselves. Verify the same auto-zoom issue doesn't also occur on the project-name input or any other text input in the app — if it does, fix those too as part of this change since they share the same root cause.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/index.js`
  - Completed: 2026-04-19

- [x] **[MEDIUM]** Make projects sidebar resizable against todo items panel
  - Description: The Projects sidebar has a fixed width, which causes longer project titles to be truncated with an ellipsis (e.g., "CS204 - Database Progra..."). Users have no way to see the full titles. Add a draggable vertical divider between the Projects sidebar and the Todo Items panel so users can resize the two panels against each other. Cursor should change to a horizontal resize indicator when hovering the divider. Enforce sensible min/max widths on the sidebar (e.g., minimum ~120px so it doesn't collapse entirely, maximum ~50% of the viewport so it can't swallow the todo panel). Persist the user's chosen width in localStorage so it survives reloads. On mobile/narrow viewports where the layout likely stacks or behaves differently, the resize handle should be hidden or disabled — match whatever responsive behavior the app already uses.
  - File: `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-19
     
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
  - Completed: 2026-04-20

- [ ] **[MEDIUM]** Add drag-and-drop reordering for projects and todo items
  - Description: Allow users to reorder both projects in the sidebar and todo items within the currently selected project by dragging them into a new position. Implement both behaviors in a single consistent pattern so they look and feel the same. On drag start, the element being dragged should have a visual indicator (reduced opacity or subtle lift/shadow). As the user drags over other elements, show a drop indicator (a horizontal line or highlighted gap) at the target insertion point. On drop, the list reorders and the new order persists so it survives reloads — save the updated order in the data model (likely in `listLogic.js`) for both projects and per-project todo item arrays. Use the native HTML5 drag-and-drop API rather than adding a new library. If either list overflows vertically, auto-scroll when the user drags near its top or bottom edge. On mobile/touch devices, add touch event handlers (touchstart/touchmove/touchend) so the feature works on touch as well as mouse. Scope: projects can only be reordered among projects, and todo items can only be reordered within their current project — dragging todo items between projects is out of scope. Where possible, share the drag-and-drop logic between the two contexts (e.g., a single reusable handler or helper) rather than duplicating code.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

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
