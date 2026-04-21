# TODO List

## Bugs

- [x] **[HIGH]** Fix font size growing on todo items after deletion
  - Description: When a todo item is deleted, the font size of the remaining items increases. Expected behavior: font size stays constant regardless of how many items are added or removed. Likely cause is a CSS rule using a relative/viewport unit (vh, vw, %) on the list or items that recalculates as the list shrinks, or a JS handler that re-applies sizing on delete. Investigate both the stylesheet and the delete handler.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-19 (PR #4)

- [x] **[MEDIUM]** Hide due date field on blank placeholder todo row
  - Description: The blank "new item" placeholder row pinned at the top of each project's list shows the "Due: MM/DD/YYYY" field even though no item exists yet, creating unnecessary visual noise next to an empty title input. Hide both `dateText` and `dueInput` when `item.tit` is empty (matching the existing pattern for `checkToDo`, `descToggle`, and `closeButtonToDo`, which already set `style.display = "none"` on blank rows), then reveal them inside the `toDoInput` keydown Enter handler alongside the other controls that get unhidden on first commit. Hiding is preferred over removing so `wireDateInputs` and `setDueDatePlaceholders` can still wire and pre-fill the inputs normally — they just stay invisible until the row is committed.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-04-21

- [x] **[MEDIUM]** Fix todo description not saving when cleared via backspace and persisting stale value on reopen
  - Description: When a user backspaces a todo item's description down to empty and clicks away, the empty value is never persisted — reopening the description panel re-displays the previous (deleted) text because `item.desc` still holds the old string. Pressing Enter on an empty description also fails: it just paints the input with a solid red border and refuses to commit. Expected behavior: an empty description should be a valid, saveable state (clearing a description is a legitimate user action), persisting on both blur and Enter, and reopening the panel should reflect the cleared value. Root cause is in `buildToDoRow` in `main.js`: the `descInput` keyup handler only writes to `item.desc` when `val.length > 0`, the keydown Enter handler treats empty as an error (red border, no save) instead of as a clear, and there is no blur handler at all — so click-away never persists. Fix by removing the length guards so empty strings save normally, dropping the red-border rejection on Enter, and adding a blur listener on `descInput` that mirrors the keyup save path. Match the pattern already used by the title input's keyup/blur save flow for consistency.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-04-21

- [x] **[MEDIUM]** Fix todo reorder not persisting across re-renders (e.g. switching projects)
  - Description: After dragging a todo item to a new position within a project, the new order is reflected visually but is lost the next time the project is re-rendered (switching to another project and back, or reloading). The DOM appears to update correctly on drop, but the underlying array order doesn't match what the user sees, so any subsequent rebuild from the data model snaps back to a stale (or scrambled) order. Root cause is an index-space mismatch between the drag layer and the model. In `attachToDoDrag` (in `main.js`), `fromIdx`/`toIdx` are computed via `draggableSiblings`, which filters out the non-draggable blank placeholder pinned at index 0 — so those indexes are zero-based within the *draggable* todos only. But `reorderToDo` in `listLogic.js` splices directly into the full project array which *includes* the blank at index 0, so every reorder is effectively off-by-one and operates on the wrong items. The visual move looks right because `onReorder` also moves the DOM nodes in-place using the same draggable-filtered siblings, but the persisted model is wrong; once `sortCompletedInPlace` re-runs on the next render it surfaces the mismatch. Fix by reconciling the two index spaces: either (a) translate draggable indexes to full-array indexes before calling `reorderToDo` (offset by the blank's position), or (b) make `reorderToDo` itself operate on the non-blank slice and rebuild the array with the blank pinned at index 0 — the latter is cleaner and keeps the placeholder invariant centralized in `listLogic.js`. Verify by reordering, switching projects, switching back, and reloading; the order should match the final drop position in all three cases.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-21

- [x] **[MEDIUM]** Fix Enter on committed todo creating extra blank row instead of focusing existing placeholder
  - Description: When Enter is pressed inside a todo row that has already been committed (the row has a title), an additional empty placeholder row is created instead of focus simply moving to the existing blank placeholder pinned at index 0. Expected behavior: a re-commit should be a no-op for list structure — it should blur the current input and shift focus to the existing blank row at the top of the list. A new blank should only be spawned when the user is committing the row that *was* the blank placeholder. Likely root cause: the `toDoInput` keydown Enter handler in `buildToDoRow` (in `main.js`) doesn't distinguish first-commit from re-commit — it always calls `appendNewToDoRow`, which runs `sortCompletedToBottom` + `reorderToDoDOM` on every Enter. Fix by capturing the row's committed state at focus-time (the existing `savedTitle` variable already tracks this — `savedTitle === ""` means we're committing the blank, otherwise we're re-editing) and on re-commit, skip the rebuild path entirely: just blur and call a focus-only helper that finds the existing blank `#toDoInput` and focuses it without touching the model or DOM structure.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-04-21

- [x] **[MEDIUM]** Fix drag-and-drop reordering breaking completed-items-at-bottom invariant
  - Description: Drag-and-drop currently lets the user drop an uncompleted todo below a completed one, or drag a completed item up among uncompleted ones, breaking the invariant that completed items always sit at the bottom of the list (an invariant the rest of the system — `sortCompletedInPlace`, `sortCompletedToBottom`, the checkbox handler, restore-from-storage — actively maintains). After drop the new order persists to localStorage and survives reloads. Fix in either `reorderToDo` (re-run `sortCompletedInPlace` after the splice and have the DOM-move logic in `attachToDoDrag.onReorder` re-render from the model instead of moving the dragged node in-place), or by clamping `toIdx` in `setupRowDrag.computeDropIndex` to the uncompleted/completed boundary so completed rows can only reorder among themselves and uncompleted rows can only reorder above the first completed row. The model-side fix is more robust since it also covers any future reorder caller.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-21

- [x] **[LOW]** Remove unused grey buttons from top-right of header
  - Description: Two small grey circular buttons sit in the top-right corner of the header (visible alongside the hamburger menu on the left and the "PROJECTS" / "TODO ITEMS" column labels below). They were an early design placeholder that never got wired up to any functionality. Remove the markup for both buttons and any associated CSS rules. Verify no event handlers or references to them exist in the JS files; if any are found, remove those too.
  - File: `toDoList_main/src/index.js`, `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-04-19

- [x] **[LOW]** Restore due date field on mobile UI (currently hidden below 420px)
  - Description: On narrow viewports the due date field is missing from todo rows entirely, leaving users with no way to view or edit due dates on phones. Root cause is an explicit `display: none` on `#dateText` and `#dueInput` inside the `@media (max-width: 420px)` block in `style.css` — likely added as a quick space-saving measure when the row was too cramped to fit everything. Expected behavior: due date stays visible and editable on mobile, with the row laid out so it still fits comfortably. Fix by removing the `display: none` rule and adjusting the mobile layout so the date inputs fit alongside the title, checkbox, desc toggle, and close button — options include dropping the "Due:" label on small screens (keep just the MM/DD/YYYY inputs), shrinking the date input widths further, allowing the title to truncate with ellipsis so the date column has guaranteed space, or wrapping the date onto a second line within the row. Pick whichever keeps the row height reasonable and the date legible. Verify at 420px, 375px (iPhone SE), and 320px widths.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-04-21
  

## Features

- [x] **[HIGH]** Add description box toggle
  - Description: Add a drop down toggle to each toDo list item instead of needing to click directly on the item itself to open the description
  - File: `toDoList_main/src/style.css/`, `toDoList_main/src/main.js/`, `toDoList_main/src/index.js/`, `toDoList_main/src/toDo.js/`
  - Completed: 2026-04-18 (PR #3)

- [x] **[MEDIUM]** Add expand all and collapse all buttons for todo descriptions
  - Description: Add "Expand All" and "Collapse All" buttons to the Todo Items header bar (right-aligned, small uppercase labels with chevron icons matching the existing `#mainHead` style). Clicking Expand All should open every committed row's description panel by triggering the same DOM insertion that `wireDescToggle` performs per-row; Collapse All should remove every open `#descSibling` panel and reset each row's `#descToggle` to its closed state. Skip blank placeholder rows, since they have no description. Make sure individual per-row toggles continue to work correctly after a bulk action — the switcher state inside `wireDescToggle` must stay in sync with the actual DOM.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-21

- [ ] **[MEDIUM]** Add collapsible "Completed" section for checked-off todo items
  - Description: Group completed todos into a collapsible section rendered directly below the uncompleted items, replacing the current flat layout where completed rows simply sit beneath uncompleted ones. Add a toggle row with a right-pointing caret and the label `Completed (N)` where N is the count of completed items in the current project, styled in uppercase with letter-spacing to match the existing `#sideHead`/`#mainHead` typography and colored with `--accent-text` (#9D8FFF). Clicking the toggle expands/collapses the list of completed rows beneath it; the caret rotates 90° on expand using the same transition pattern as `#descToggle`. The section starts collapsed every time a project is rendered (no persistence across reloads), and the toggle row is hidden entirely when the project has zero completed items. Update `reorderToDoDOM`, `addAllToDo_DOM`, and `addToDos_restore` to render uncompleted rows, then the toggle (if any completed exist), then the completed rows inside a wrapper div that controls visibility. The model ordering invariant in `sortCompletedInPlace` (blank → uncompleted → completed) stays as-is — only the DOM rendering changes.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[LOW]** Add custom home screen icon and PWA manifest using favicon.svg as source
  - Description: When users add the app to their home screen on iOS or Android, the icon defaults to a generic browser screenshot instead of a branded app icon. Use `favicon.svg` as the single source asset: reference it directly via `<link rel="icon" type="image/svg+xml">` for modern browsers, and generate PNG variants from it for platforms that don't accept SVG — a 180x180 `apple-touch-icon.png` for iOS, plus 192x192 and 512x512 (including a maskable variant with safe-zone padding) for Android. Add a `manifest.webmanifest` declaring `name`, `short_name`, `start_url`, `display: "standalone"`, `background_color`, `theme_color`, and the icons array. Reference the manifest from `index.html` and add `<meta name="theme-color">` plus the iOS standalone meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-title`). Either commit pre-generated PNGs or wire a webpack plugin like `favicons-webpack-plugin` into `webpack.config.js` so PNGs regenerate from the SVG automatically — prefer the latter to keep the SVG as the single source of truth.
  - File: `toDoList_main/src/index.html`, `toDoList_main/src/favicon.svg`, `toDoList_main/src/manifest.webmanifest`, `toDoList_main/webpack.config.js`
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
