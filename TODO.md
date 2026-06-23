# TODO LIST

- [x] **[LOW]** Keep the "Show completed (N)" overflow item on one line
  - Type: bug
  - Description: In the TODO.md viewer's overflow menu, the "Show completed (N)" item wraps its count onto a second line ("Show completed" / "(1)"). The item (`.todoMdViewerShowCompletedItem`) is a flex row of a checkmark plus the label (`.todoMdViewerShowCompletedLabel`, `flex: 1 1 auto`), and at the menu's `min-width: 150px` the checkmark + the "Show completed (N)" text exceeds the available label width; with no `white-space` rule on the label, it wraps. Fix in CSS only: add `white-space: nowrap` to `.todoMdViewerShowCompletedLabel` (or `.todoMdViewerShowCompletedItem`) so the text stays on one line — the menu is absolutely positioned with `min-width: 150px` and no max-width, so it grows to fit single-line content. If the menu doesn't widen on its own, also give `.todoMdViewerOverflowMenu` `width: max-content` (keeping the 150px floor) so it sizes to its widest item. No JS change — the label is already a single string. Confirm the longer "Hide completed (N)" state and the Clear items also stay single-line, and the menu doesn't overflow the viewport in the mobile sheet.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: 20112c26-f035-4895-9d12-79bb4055448f -->

- [x] **[MEDIUM]** Fix the TODO.md viewer overflow menu being clipped when the card is collapsed
  - Type: bug
  - Description: When the TODO.md viewer card is collapsed (its default state), tapping the "⋯" overflow button opens the menu but nothing is visible — you have to expand the card so the entries/body exist before the menu shows. Cause: `.todoMdViewerCard` has `overflow: hidden`, and `#mainList .todoMdViewerCard.collapsed .todoMdViewerBody` is `display: none`, so a collapsed card is only as tall as its header; the menu (`.todoMdViewerOverflowMenu`, `position: absolute; top: calc(100% + 6px)`) drops below the header into a region that now falls outside the card's box and is cropped by the card's `overflow: hidden`. Fix: while the menu is open, let the inline card's overflow show — add a class to the card in `openOverflowMenu()` and remove it in `closeOverflowMenu()` (same spot the outside-click/Escape handlers are wired), backed by CSS `#mainList .todoMdViewerCard.todoMdViewerCard--menuOpen { overflow: visible; }`. This is sizing-safe: `#mainList .todoMdViewerCard` already pins `min-height: max-content`, so the card's height doesn't depend on `overflow` (the auto-min override that `overflow: hidden` triggers only fires when `min-height` is `auto`), and the body keeps its own `overflow: auto` / `max-height`. Verify the menu now renders over the area beneath the collapsed card, and check the `#todoMdViewerMobileSheet` placement — if a collapsed card clips it there too, extend the same `--menuOpen` toggle with a sheet-scoped `overflow: visible`.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/todoMdViewer.js`
  - Completed: 2026-06-23
  <!-- id: 9909567b-d4a7-4be6-bc5e-817799cebad6 -->

- [x] **[MEDIUM]** Use a modal menu instead of a dropdown for the todo viewer's overflow button on mobile
  - Type: feature
  - Description: In the todo viewer section, tapping the overflow (⋯) menu button on mobile currently opens a dropdown that is cramped and easy to mis-tap on touch. On mobile, the overflow button should instead open a modal/bottom-sheet menu (use the existing `mobileSheets.js` pattern) with large touch targets; desktop keeps the existing anchored dropdown unchanged. Preserve all current overflow-menu behavior: every menu item's action/click handler must still fire; the menu must close on item selection, backdrop tap/outside-click, and Escape; and any state the menu reads (the entry/section currently in view) must remain in scope when the menu is rendered as a modal rather than as a sibling dropdown. The likely code lives in `toDoMdViewer.js` (overflow button + menu construction) with the mobile sheet wiring from `mobileSheets.js` and styling in `style.css`.
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/mobileSheets.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: 2479dc6b-f7cd-418f-af28-b6f048f1af31 -->

- [ ] **[HIGH]** Fix white page after deploy by handling service-worker updates cleanly
  - Type: bug
  - Description: After a new version deploys, the app keeps serving the old cached bundle, and on refresh the HTML references a new content-hashed bundle the stale cache can't supply — producing a white page that only a hard refresh clears. Fix the service-worker update lifecycle so a new worker activates and takes control without a manual hard refresh: call `skipWaiting`/`clients.claim` appropriately, detect the waiting worker on registration, and surface a small non-blocking "Update available — tap to refresh" prompt that reloads into the new version on tap (and never serve a cached HTML shell that points at bundle filenames absent from the cache). Likely code lives in the service worker (`sw.js`) and its registration/update handling in `index.js`.
  - File: `toDoList_main/src/sw.js`, `toDoList_main/src/index.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: fbff27cb-5250-45e3-8583-5840bcf87e9c -->
