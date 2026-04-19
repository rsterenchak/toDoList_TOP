# TODO List

## Bugs

- [ ] **[HIGH]** Fix font size growing on todo items after deletion
  - Description: When a todo item is deleted, the font size of the remaining items increases. Expected behavior: font size stays constant regardless of how many items are added or removed. Likely cause is a CSS rule using a relative/viewport unit (vh, vw, %) on the list or items that recalculates as the list shrinks, or a JS handler that re-applies sizing on delete. Investigate both the stylesheet and the delete handler.
  - File: `src/style.css`, `src/main.js`, `src/index.js`, `src/toDo.js`, `src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Fix default due date showing 1/1/2023 instead of one week from today
  - Description: The due date field for new todo items defaults to a hardcoded 1/1/2023, which is a leftover placeholder from initial development. Change the default so that when a new todo item is created, the due date field is pre-filled with the date one week from the current date (today + 7 days), computed at the moment the item is created. The hardcoded value likely lives in either the DOM markup (a `value` attribute on the date input) or in `listLogic.js` where new items are instantiated — check both and remove the hardcoded date wherever it appears, replacing it with a dynamic calculation.
  - File: `src/listLogic.js`, `src/index.js`, `src/toDo.js`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[LOW]** Remove unused grey buttons from top-right of header
  - Description: Two small grey circular buttons sit in the top-right corner of the header (visible alongside the hamburger menu on the left and the "PROJECTS" / "TODO ITEMS" column labels below). They were an early design placeholder that never got wired up to any functionality. Remove the markup for both buttons and any associated CSS rules. Verify no event handlers or references to them exist in the JS files; if any are found, remove those too.
  - File: `src/index.js`, `src/style.css`, `src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[HIGH]** Add description box toggle
  - Description: Add a drop down toggle to each toDo list item instead of needing to click directly on the item itself to open the description
  - File: `src/style.css/`, `src/main.js/`, `src/index.js/`, `src/toDo.js/`
  - Completed: 2026-04-18 (PR #3)

- [ ] **[MEDIUM]** Add check-off feature for todo items
  - Description: Add a checkbox to the left of each todo item. Clicking it marks the item as completed: visually indicate completion with a strikethrough and muted text color, but keep the item in the list rather than removing it. Clicking again un-completes it. Persist the completed state on each item in the data model (likely a `completed: boolean` field on items in `listLogic.js`) so the state survives reloads alongside however items are currently stored.
  - File: `src/listLogic.js`, `src/toDo.js`, `src/style.css`, `src/index.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Replace project delete button with right-click context menu (edit + delete)
  - Description: Remove the existing `×` delete button that appears on each project in the sidebar (both the markup and any associated CSS and event handlers). Replace it with a custom context menu that appears on right-click of a project, positioned at the cursor. The menu contains two options: "Edit" (opens the existing project rename/edit flow) and "Delete" (removes the project, with a confirmation step before deletion; if the project contains todos, the confirmation should mention how many items will be lost). Suppress the browser's default right-click menu on project elements only, not globally. The custom menu should close on: selecting an option, clicking outside the menu, pressing Escape, or right-clicking elsewhere. Style it to match the existing dark theme. Note: right-click is desktop-only — add a long-press handler (roughly 500ms) on touch devices that opens the same menu, so mobile users retain access to edit/delete. Scope this feature to projects only; todo items are out of scope.
  - File: `src/index.js`, `src/main.js`, `src/listLogic.js`, `src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[LOW]** Implement light mode
  - Description: Add a theme toggle in the top-right of the header using a sun/moon icon button (the dominant pattern in modern web apps). Clicking swaps between dark and light themes. Default to dark mode on first load, and persist the user's choice in localStorage so it survives reloads and return visits. The light theme should be a soft, dimmed off-white — closer to a low-brightness night-reading palette than a bright paper-white — to reduce contrast with the existing dark theme's aesthetic.
  - File: `src/style.css`, `src/main.js`, `src/index.js`, `src/toDo.js`, `src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[LOW]** Add changelog button to todo list app
  - Description: Add a changelog button to the header (icon-based, with a "Changelog" tooltip on hover) that opens a modal displaying version history when clicked. Create a new `src/changelog.js` file that exports a hardcoded array of changelog entries; each entry has a version string, a date, and categorized bullet lists (Added / Fixed / Changed, following the Keep a Changelog convention). The modal renders these entries newest-first, with version and date as the heading for each block. Include a close button (X in the corner) and support closing via the Escape key and clicking the backdrop. Style the modal to match the existing dark theme. Seed the file with one placeholder entry so the modal has something to show on first render.
  - File: `src/changelog.js`, `src/index.js`, `src/main.js`, `src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
