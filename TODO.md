# TODO List

## Bugs

- [x] **[MEDIUM]** Fix calendar hamburger overlap and add empty-state ghost to Today and Projects views on mobile
  - Description: Two related mobile layout fixes. (1) On the Calendar view, the hamburger sidebar toggle is positioned at the same vertical level as the month-navigation row, causing it to overlap the right-side next-month `>` arrow on narrow viewports. Lift the hamburger to its own row above the calendar header inside the mobile `@media (max-width: 700px)` block so the prev/next arrows and "May 2026" label sit on a dedicated row below it with no overlap; the existing safe-area-inset-top padding floor stays in place under the hamburger. (2) On the Today and Projects views, when the page has few items the content sits in the top ~30% of the viewport and leaves a large empty void above the tab bar that reads as poorly anchored. Add an empty-state ghost companion that fills the remaining vertical space below the content list — reuse the existing ghost mascot SVG already used on the no-projects welcome state, dimmed to ~50% opacity, with a short caption underneath ("Nothing else due" for Today, "That's all for this project" for Projects). Anchor it via a flex spacer so it centers in whatever vertical space remains after the content list — when the list grows enough to fill the viewport, the ghost is pushed offscreen naturally with no extra logic. Honor the existing companion-ghost preference toggle in settings: when the user has turned the ghost off, the spacer remains empty so the layout doesn't shift.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-20

## Features

- [x] **[MEDIUM]** Add first-run spotlight coachmark tour for new users (desktop)
  - Description: First-time users currently land on a near-empty Void screen (ghost + "Welcome." + a single "+ New project" button) and have to discover the rest of the app on their own — projects, due-date pills, expand chevron, Pomodoro, theme toggle, sidebar. Replace that cold start with a dismissible multi-step coachmark tour that runs the first time the app loads with no saved projects. Each step dims the rest of the UI with a full-screen overlay, cuts out a single highlighted element, and anchors a small purple-bordered callout next to it (`STEP N OF M`, one sentence of guidance, Skip / pagination dots / Next ›). Proposed steps: (1) the sidebar "+" project button, (2) the todo input row, (3) the due-date pill on the first todo row, (4) the expand-description chevron, (5) the Pomodoro/music navbar surface. The tour advances on Next or when the user actually interacts with the highlighted element (clicks +, types in the input, etc.) and ends on the last step with a "You're set" closer that drops them into a normal first project. Persists a `todoapp_onboardingComplete` flag in localStorage so it never auto-runs again; expose a "Replay welcome tour" entry in the sidebar settings panel for re-triggering. Constraints: no new dependencies (build the overlay + cutout + callout in vanilla JS — a fixed full-viewport `<div>` with a `clip-path` or four-rect mask around the target's `getBoundingClientRect`), close on Escape and on backdrop click outside the callout, recompute target geometry on `resize` / `scroll`, and keep the overlay above all existing popovers/modals. Mobile is intentionally out of scope for this entry — a follow-up will adapt the flow for narrow viewports.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-05-18

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
