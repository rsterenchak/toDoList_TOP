# TODO LIST

  - Type: bug
  - Description: The ✦ glyph on the mobile `#claudeLauncher` FAB still appears visually off-center after the prior 1px translateY nudge. Change the `transform` on `#claudeLauncher` inside `@media (max-width: 1023px)` from `translateY(1px)` to `translateY(-10%)` so the glyph shifts up by 10% of the button's height. Update the existing regression test in `mobileLauncherSparkleCentering.test.js` to expect the new value. No other properties (size, color, glow, position) should be changed.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/mobileLauncherSparkleCentering.test.js`
  - Completed: 2026-06-25
  <!-- id: 99333a94-9d75-4d38-af8d-99fbca429860 -->

  - Type: bug
  - Description: The current `translateY(-10%)` on `#claudeLauncher` at `@media (max-width: 1023px)` is insufficient to optically center the sparkle glyph. Change the transform to `translateY(-15px)` for a fixed, density-independent upward shift. Update the corresponding test in `mobileLauncherSparkleCentering.test.js` to expect value `-15` with unit `px`.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/mobileLauncherSparkleCentering.test.js`
  - Completed:
  <!-- id: 650f005c-9237-4366-9623-55234e32b68c -->

  - Type: feature
  - Description: The bottom navigation tab currently labeled "Projects" on mobile should read "Tasks View" instead. Only the visible label text should change — the tab's functionality, event listeners, ARIA attributes, and any JS selectors that reference the tab by class or data attribute must remain untouched. Locate the tab label text in `toDoList_main/src/index.js` (where DOM markup is rendered) or `toDoList_main/src/mobileSheets.js` (mobile sheet/tab wiring) and update the string.
  - File: `toDoList_main/src/index.js`, `toDoList_main/src/mobileSheets.js`
  - Completed: 2026-06-27
  <!-- id: 949653a0-39fb-46b5-b598-6bd7d8bc97f2 -->

  - Type: feature
  - Description: The Structure tab (`#mobileTabStructure` on mobile, the desktop structure panel) has no way to collapse sections — on deep trees the user must scroll extensively. Add a thin toolbar strip below the tab bar containing a pill button that collapses all sections at once; when any section is collapsed the pill label switches to "Expand all" and re-expands everything. Each section header should also gain an individual chevron for per-section toggling that stays in sync with the global pill state. Collapsed state is UI-only (not persisted); it resets when the tab is closed or re-opened. Ensure the toolbar and pill render correctly at both mobile and desktop breakpoints using existing CSS variables.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 546e66c5-bfd0-49bf-8baf-04cdf8ac34ea -->

  - Type: feature
  - Description: The all/active/ideas filter bar (task filter tabs) is currently left-aligned. Update its container to use `display: flex; justify-content: center` (or equivalent) so the bar sits centered in its parent. Change is purely cosmetic — no logic or event wiring is affected.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/taskFilter.js`
  - Completed: 2026-06-28
  <!-- id: e9730cb3-a795-44c1-8d8a-1635cd0322ca -->

  - Type: feature
  - Description: The task filter pill inside `#mainBar` is currently centered or right-aligned on desktop. It should be left-aligned so it sits flush with the left edge of the main content area. Update the flex/layout rules for the filter pill container in `style.css` targeting desktop breakpoints so the pill aligns left rather than centered.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/taskFilter.js`
  - Completed: 2026-06-29
  <!-- id: 979c350b-bf49-43a1-bc63-7aa07e07680b -->
