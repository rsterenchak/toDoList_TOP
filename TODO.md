# TODO List

## Bugs

- [x] **[LOW]** Style page scrollbars as ultra-thin neutral to match Void dark aesthetic
  - Description: The default browser scrollbar (bright white thumb and track on near-black background) clashes hard with the dark Void aesthetic and is the most visually jarring element on long scrollable views like the expanded calendar. Style scrollbars globally via the `*` selector so every scrollable surface (page, projects sidebar, todo lists, modals, popovers) is covered: 4px width, transparent track (no visible rail), muted gray thumb (~`#3a3a48`) with rounded corners (~2px radius), and a slightly lighter thumb on `:hover` for a subtle lift. Use the WebKit pseudo-elements (`::-webkit-scrollbar`, `::-webkit-scrollbar-track`, `::-webkit-scrollbar-thumb`, `::-webkit-scrollbar-thumb:hover`) for Chromium/Safari, and pair with `scrollbar-width: thin` + `scrollbar-color: #3a3a48 transparent` for Firefox. Pure CSS — no JS or new dependencies.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-18

## Features

- [x] **[MEDIUM]** Add first-run spotlight coachmark tour for new users (desktop)
  - Description: First-time users currently land on a near-empty Void screen (ghost + "Welcome." + a single "+ New project" button) and have to discover the rest of the app on their own — projects, due-date pills, expand chevron, Pomodoro, theme toggle, sidebar. Replace that cold start with a dismissible multi-step coachmark tour that runs the first time the app loads with no saved projects. Each step dims the rest of the UI with a full-screen overlay, cuts out a single highlighted element, and anchors a small purple-bordered callout next to it (`STEP N OF M`, one sentence of guidance, Skip / pagination dots / Next ›). Proposed steps: (1) the sidebar "+" project button, (2) the todo input row, (3) the due-date pill on the first todo row, (4) the expand-description chevron, (5) the Pomodoro/music navbar surface. The tour advances on Next or when the user actually interacts with the highlighted element (clicks +, types in the input, etc.) and ends on the last step with a "You're set" closer that drops them into a normal first project. Persists a `todoapp_onboardingComplete` flag in localStorage so it never auto-runs again; expose a "Replay welcome tour" entry in the sidebar settings panel for re-triggering. Constraints: no new dependencies (build the overlay + cutout + callout in vanilla JS — a fixed full-viewport `<div>` with a `clip-path` or four-rect mask around the target's `getBoundingClientRect`), close on Escape and on backdrop click outside the callout, recompute target geometry on `resize` / `scroll`, and keep the overlay above all existing popovers/modals. Mobile is intentionally out of scope for this entry — a follow-up will adapt the flow for narrow viewports.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-05-18

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
