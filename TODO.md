# TODO List

## Bugs

- [x] **[MEDIUM]** Add safe-area-inset-top padding to Today and Calendar views on mobile
  - Description: On mobile (iOS Safari and notched devices), the Today view's date header ("Tuesday, May 19") and the Calendar view's prev-month arrow / "May 2026" label collide with the iOS status bar / Dynamic Island because `#todayView` and `#calendarView` use flat `padding: 24px 16px` / `padding: 24px 48px` and don't fold in `env(safe-area-inset-top)` the way `#mobileProjHeader`, `#emptyState.emptyStateNoProjects`, and `#sidebarToggle` already do. Fix inside the `@media (max-width: 700px)` block by replacing each view's top padding with `calc(max(env(safe-area-inset-top, 0px), 24px) + Npx)` so the inset is honored on notched devices and a 24px floor (matching the hamburger pattern) keeps regular-browser-tab contexts from hugging the viewport top. Pick `N` so the resulting title position visually matches the existing 24px content gap inside each view (likely keep the current 24px content offset on top of the inset reservation). Also tighten the small gap at the bottom of `#calendarView` on mobile — `padding-bottom: 24px` is stacking on top of the `padding-bottom: var(--mobile-tab-h, 56px)` override, so the day-detail panel sits ~24px above the tab bar instead of flush; collapse the override so only the tab-bar reservation applies.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-19

## Features

- [x] **[MEDIUM]** Add first-run spotlight coachmark tour for new users (desktop)
  - Description: First-time users currently land on a near-empty Void screen (ghost + "Welcome." + a single "+ New project" button) and have to discover the rest of the app on their own — projects, due-date pills, expand chevron, Pomodoro, theme toggle, sidebar. Replace that cold start with a dismissible multi-step coachmark tour that runs the first time the app loads with no saved projects. Each step dims the rest of the UI with a full-screen overlay, cuts out a single highlighted element, and anchors a small purple-bordered callout next to it (`STEP N OF M`, one sentence of guidance, Skip / pagination dots / Next ›). Proposed steps: (1) the sidebar "+" project button, (2) the todo input row, (3) the due-date pill on the first todo row, (4) the expand-description chevron, (5) the Pomodoro/music navbar surface. The tour advances on Next or when the user actually interacts with the highlighted element (clicks +, types in the input, etc.) and ends on the last step with a "You're set" closer that drops them into a normal first project. Persists a `todoapp_onboardingComplete` flag in localStorage so it never auto-runs again; expose a "Replay welcome tour" entry in the sidebar settings panel for re-triggering. Constraints: no new dependencies (build the overlay + cutout + callout in vanilla JS — a fixed full-viewport `<div>` with a `clip-path` or four-rect mask around the target's `getBoundingClientRect`), close on Escape and on backdrop click outside the callout, recompute target geometry on `resize` / `scroll`, and keep the overlay above all existing popovers/modals. Mobile is intentionally out of scope for this entry — a follow-up will adapt the flow for narrow viewports.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-05-18

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
