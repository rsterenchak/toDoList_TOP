# TODO List

## Bugs
  
- [x] **[LOW]** `projectLength` should return 0 for null or undefined project names
  - Description: `projectLength(project)` in `listLogic.js` currently guards against falsy input with `if (!project || !allProjects[project]) return 0;`, which is fine — but the function's behavior when passed a non-string value (e.g., `projectLength(42)` or `projectLength({})`) is undefined. In practice nothing in the app calls it with non-string values today, but the guard is permissive enough to let weird inputs through and return `undefined` or throw depending on what `allProjects[project]` does with them. Tighten the guard so the function returns 0 for any input that isn't a non-empty string. Preserve existing behavior for valid string inputs. Add a regression test covering non-string inputs (number, object, array, boolean) alongside the existing null/undefined cases.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [ ] **[LOW]** Implement light mode
  - Description: Add a theme toggle in the top-right of the header using a sun/moon icon button (the dominant pattern in modern web apps). Clicking swaps between dark and light themes. Default to dark mode on first load, and persist the user's choice in localStorage so it survives reloads and return visits. The light theme should be a soft, dimmed off-white — closer to a low-brightness night-reading palette than a bright paper-white — to reduce contrast with the existing dark theme's aesthetic.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[LOW]** Add changelog button to todo list app
  - Description: Add a changelog button to the header (icon-based, with a "Changelog" tooltip on hover) that opens a modal displaying version history when clicked. Create a new `toDoList_main/src/changelog.js` file that exports a hardcoded array of changelog entries; each entry has a version string, a date, and categorized bullet lists (Added / Fixed / Changed, following the Keep a Changelog convention). The modal renders these entries newest-first, with version and date as the heading for each block. Include a close button (X in the corner) and support closing via the Escape key and clicking the backdrop. Style the modal to match the existing dark theme. Seed the file with one placeholder entry so the modal has something to show on first render.
  - File: `toDoList_main/src/changelog.js`, `toDoList_main/src/index.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[LOW]** Add custom home screen icon and PWA manifest using favicon.svg as source
  - Description: When users add the app to their home screen on iOS or Android, the icon defaults to a generic browser screenshot instead of a branded app icon. Use `favicon.svg` as the single source asset: reference it directly via `<link rel="icon" type="image/svg+xml">` for modern browsers, and generate PNG variants from it for platforms that don't accept SVG — a 180x180 `apple-touch-icon.png` for iOS, plus 192x192 and 512x512 (including a maskable variant with safe-zone padding) for Android. Add a `manifest.webmanifest` declaring `name`, `short_name`, `start_url`, `display: "standalone"`, `background_color`, `theme_color`, and the icons array. Reference the manifest from `index.html` and add `<meta name="theme-color">` plus the iOS standalone meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-title`). Either commit pre-generated PNGs or wire a webpack plugin like `favicons-webpack-plugin` into `webpack.config.js` so PNGs regenerate from the SVG automatically — prefer the latter to keep the SVG as the single source of truth.
  - File: `toDoList_main/src/index.html`, `toDoList_main/src/favicon.svg`, `toDoList_main/src/manifest.webmanifest`, `toDoList_main/webpack.config.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
