# TODO LIST

- [x] **[LOW]** Rename the create chip row away from the `mobile*` prefix — Completed: 2026-07-24
  - Type: feature
  - Description: The task-create chip row is `#mobileCreateChips` with `.mobileCreateChip` / `.mobileCreateChipSelected` / `.mobileCreatePasteChip` / `.mobileCreateDescChip` classes, but the 📋 paste-entry chip now surfaces on desktop too, so the `mobile*` prefix is misleading — the same kind of naming confusion that made the file picker's host scoping hard to reason about. This was deliberately deferred from the "make the paste-entry chip available on desktop" entry, which noted the naming can be corrected separately.
  - Behavior: No user-visible change on either mobile or desktop — the chip row, its date/description chips, and the paste chip behave exactly as today. Only the internal element id and CSS class names change.
  - Implementation notes:
    - Rename the `#mobileCreateChips` id and the `.mobileCreate*` CSS classes to a neutral, host-agnostic name (e.g. `#createChipRow` / `.createChip*`). Update every selector and reference across `style.css`, `toDoRow.js`, `mobileTaskCreate.js`, and `tests/mobileInlineExpandCreate.test.js`. Do not leave an alias.
    - Keep the `mobileTaskCreate.js` filename and its exported function names (`attachMobileCreateChips`, `resetMobileCreateSession`, …) unchanged in this pass — id and CSS class names only, to bound the blast radius. Renaming the module and its exports is a separate follow-up if wanted.
    - The chip row is referenced by id in several spots in `toDoRow.js` (the descSibling anchor walk, the reorder-rebuild sibling collection, and the commit cleanup). Grep for the id and update all of them, and re-run the create-row test suite.
  - Out of scope: Any behavioral change to the chip row, the paste flow, the date/description chips, or the desktop reveal. Renaming the `mobileTaskCreate.js` file or its exports.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/toDoRow.js`, `toDoList_main/src/mobileTaskCreate.js`
