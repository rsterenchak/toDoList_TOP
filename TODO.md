# TODO List

## Bugs
     
- [x] **[LOW]** Mute the hamburger icon and add a divider before the kebab menu
  - Description: Drop the top-left hamburger icon's color from the bright purple accent to the same neutral gray used by the save and import buttons, so the top bar reads as a single unified group rather than one loud purple element competing with the muted icons. Then add a hairline vertical divider (1px wide, ~18px tall, low-opacity white) between the import button and the kebab menu, signaling that the kebab is in a different category (settings/menu) from the data actions to its left. Both changes are purely cosmetic — the divider can be done as a `::before` pseudo-element on the kebab and the hamburger color via a simple stroke/color override.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-03

## Features

- [x] **[MEDIUM]** Convert PROJECTS sidebar to a 54px icon rail
  - Description: Replace the full-width PROJECTS sidebar with a narrow icon rail. Each project becomes a 34px rounded square showing its first letter in neutral gray-on-dark; the active project gets the purple accent (background, border, text). The hamburger relocates from the top bar to the top of the rail and toggles between the rail and the full sidebar (with names + plus button); the "+" add-project button sits at the bottom of the rail with a dashed border. Each project icon shows a tooltip with its full name on hover (~300ms delay). Add a breadcrumb to the top-left of the main column showing "<Project Name> · <N> open" — since the rail only shows initials, this is the only place the active project's full name appears textually. Project initial styling stays neutral gray; no per-project hue generation. Use grep + offset/limit when navigating main.js for sidebar render logic.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-03
    
- [ ] **[MEDIUM]** Replace top-bar save/import/kebab cluster with a ghost menu trigger
  - Description: Remove the existing save, import, divider, and kebab buttons from the top right and replace them with a single 36px ghost button. Clicking it opens a dropdown containing: Export JSON, Import JSON, (divider), Theme, and a "Toggle floating ghost" item with an ON/OFF tag reflecting whether the bottom-of-screen floating ghost is active. The ghost button itself stays static in the top-right and does not float around. It gets a subtle hover-pulse animation (gentle scale/opacity loop, ~700ms cycle) for discoverability — first-time users need a hint that the ghost is clickable. Menu closes on selection, outside click, or Escape. This supersedes the earlier "settings dropdown" entry — save and import now join the menu rather than living separately on the top bar. Use grep + offset/limit when navigating main.js.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
