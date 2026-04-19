# CLAUDE.md

Guidance for Claude when writing or reviewing code in this repo. Rules here are enforced by automated review — keep them concrete and verifiable.

## Project overview

A single-page todo list web app. Users create projects in a left sidebar, add todo items to the selected project, and manage them (edit, delete, check off, reorder). Runs in the browser with no backend — all state is client-side, persisted via `localStorage`. Bundled with webpack.

## Stack and constraints

- Vanilla JavaScript (no framework). Do not introduce React, Vue, Svelte, or any other framework.
- Plain CSS. Do not introduce Tailwind, CSS-in-JS, or preprocessors.
- Webpack handles bundling; Babel handles transpilation. Do not change the build toolchain.
- No new dependencies without an explicit task instruction to add one. This includes drag-and-drop libraries, date libraries, UI component libraries, and icon packages.
- Use native browser APIs wherever possible (HTML5 drag-and-drop, `localStorage`, `addEventListener`, etc.).

## Repo layout

- `toDoList_main/` — project root. Contains `package.json`, `webpack.config.js`, `.babelrc`, and the `src/` and `dist/` folders.
- `toDoList_main/src/` — all source code, assets, fonts, and icons.
- `toDoList_main/dist/` — webpack build output. **Never edit files here directly; they are regenerated on build.** Do not commit changes to `dist/` as part of a feature or bug task.
- `toDoList_main/node_modules/` — dependencies. Never edit.
- `TODO.md`, `CLAUDE.md`, `claude-config.md`, `README.md` — all at the repo root, one level above `toDoList_main/`.

## Source file organization

All source lives in `toDoList_main/src/`. Each JS file has a defined responsibility — stay within it:

- `toDoList_main/src/index.js` — DOM structure and markup rendering. Owns what the page looks like.
- `toDoList_main/src/main.js` — App bootstrap and event wiring. Owns how user actions connect to logic.
- `toDoList_main/src/toDo.js` — Rendering and interaction for todo items within the selected project.
- `toDoList_main/src/listLogic.js` — Data model for projects and todo items. All mutations to the data model go through here.
- `toDoList_main/src/style.css` — All styling. No inline styles in JS or HTML unless computed dynamically (e.g., drag position).

Do not mutate the data model from UI files (`index.js`, `toDo.js`, `main.js`). Go through `listLogic.js`.

## Assets

- Icons are SVG files committed to `toDoList_main/src/` (e.g., `addProj_button.svg`, `close-svgrepo-com.svg`, `empty_state.svg`, `favicon.svg`). When adding a new icon, commit the SVG file to `src/` and reference it — do not introduce icon libraries or icon fonts.
- Fonts are `.ttf`/`.otf` files committed to `toDoList_main/src/` (e.g., `SpaceMono-Regular.ttf`, `Zector.otf`) and loaded via `@font-face` in `style.css`. Do not introduce Google Fonts, font CDNs, or font loaders.

## Persistence

All user data (projects, todo items, theme choice, sidebar width, and any other user preferences) persists in `localStorage`. Key names use the prefix `todoapp_` (e.g., `todoapp_theme`, `todoapp_sidebarWidth`). State must survive page reloads.

## UI conventions

- Default theme is dark mode. A light theme exists as a user-toggleable alternative. Always honor the current theme when adding new UI — use the existing CSS variables rather than hardcoded colors.
- Modals close on: clicking an explicit close button, clicking the backdrop, and pressing Escape. All three affordances are required.
- Context menus (right-click) close on: selecting an option, clicking outside, pressing Escape, or right-clicking elsewhere. All four affordances are required.
- Destructive actions (delete project, delete todo) require a confirmation step. If the action affects other data (e.g., deleting a project with todos), the confirmation must state what will be lost.
- Text inputs used on mobile must have `font-size: 16px` or larger to prevent iOS Safari auto-zoom on focus.

## Mobile and touch

The app runs on mobile. When adding interactions:

- Right-click features must have a long-press equivalent (~500ms) for touch devices.
- HTML5 drag-and-drop events don't fire reliably on touch — add `touchstart`/`touchmove`/`touchend` handlers alongside native drag events.
- Do not suppress browser default behaviors (right-click menu, text zoom) globally. Scope suppression to the specific elements that need it.

## Scope discipline

- Keep changes scoped to the task described. Do not refactor, reformat, or fix unrelated issues in the same PR — file a new entry in `TODO.md` under the appropriate section instead.
- Do not delete or rename files unless the task explicitly requires it.
- Do not add CI workflows, license headers, or new top-level config files unless the task explicitly requires it.
- Do not modify `webpack.config.js`, `.babelrc`, `package.json`, or `package-lock.json` unless the task explicitly requires a build or dependency change.

## What not to flag in review

- Linter, formatter, or type-checker concerns (handled separately by CI).
- Missing test coverage unless the task was to add tests.
- Stylistic preferences not documented in this file.
- Pre-existing issues on lines the PR did not modify.
- Files in `dist/` or `node_modules/`.
