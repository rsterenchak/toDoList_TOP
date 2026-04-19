# TODO List

## Bugs

- [ ] **[HIGH]** Fix font size growing on todo items after deletion
  - Description: When a todo item is deleted, the font size of the remaining items increases. Expected behavior: font size stays constant regardless of how many items are added or removed. Likely cause is a CSS rule using a relative/viewport unit (vh, vw, %) on the list or items that recalculates as the list shrinks, or a JS handler that re-applies sizing on delete. Investigate both the stylesheet and the delete handler.
  - File: `src/style.css`, `src/main.js`, `src/index.js`, `src/toDo.js`, `src/listLogic.js`
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

- [ ] **[LOW]** Implement light mode
  - Description: Add a theme toggle in the top-right of the header using a sun/moon icon button (the dominant pattern in modern web apps). Clicking swaps between dark and light themes. Default to dark mode on first load, and persist the user's choice in localStorage so it survives reloads and return visits. The light theme should be a soft, dimmed off-white — closer to a low-brightness night-reading palette than a bright paper-white — to reduce contrast with the existing dark theme's aesthetic.
  - File: `src/style.css`, `src/main.js`, `src/index.js`, `src/toDo.js`, `src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
