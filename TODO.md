# TODO List

## Bugs

- [ ] **[MEDIUM]** Allow keyboard navigation from 'Today' and 'Calendar' down into `#mainList` items
  - Description: Keyboard users can focus the 'Today' and 'Calendar' header buttons via Tab, but ArrowDown from those buttons doesn't move focus into the todo rows rendered inside `#mainList` — focus either stays put or skips past the list entirely, leaving the rendered items unreachable without a mouse. Expected behavior: ArrowDown from 'Today' or 'Calendar' moves focus to the first focusable element inside `#mainList` (the first todo row, or its title/checkbox depending on the row's focus target), and ArrowUp from the first row returns focus to the originating header button. Likely cause is that the header buttons don't have a `keydown` handler that intercepts ArrowDown to redirect focus into `#mainList`, and/or `#mainList` children aren't in the tab order (missing `tabindex="0"` on the row or its focus target). Investigate the wiring for the 'Today' and 'Calendar' buttons in `main.js` (grep for their handlers), and confirm the todo-row builder assigns a focusable element to receive focus. Also verify ArrowUp/ArrowDown continue to traverse between rows once focus is inside the list — if that intra-list navigation isn't already wired, this fix should add it alongside the entry hop.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Add first-run spotlight coachmark tour for new users (desktop)
  - Description: First-time users currently land on a near-empty Void screen (ghost + "Welcome." + a single "+ New project" button) and have to discover the rest of the app on their own — projects, due-date pills, expand chevron, Pomodoro, theme toggle, sidebar. Replace that cold start with a dismissible multi-step coachmark tour that runs the first time the app loads with no saved projects. Each step dims the rest of the UI with a full-screen overlay, cuts out a single highlighted element, and anchors a small purple-bordered callout next to it (`STEP N OF M`, one sentence of guidance, Skip / pagination dots / Next ›). Proposed steps: (1) the sidebar "+" project button, (2) the todo input row, (3) the due-date pill on the first todo row, (4) the expand-description chevron, (5) the Pomodoro/music navbar surface. The tour advances on Next or when the user actually interacts with the highlighted element (clicks +, types in the input, etc.) and ends on the last step with a "You're set" closer that drops them into a normal first project. Persists a `todoapp_onboardingComplete` flag in localStorage so it never auto-runs again; expose a "Replay welcome tour" entry in the sidebar settings panel for re-triggering. Constraints: no new dependencies (build the overlay + cutout + callout in vanilla JS — a fixed full-viewport `<div>` with a `clip-path` or four-rect mask around the target's `getBoundingClientRect`), close on Escape and on backdrop click outside the callout, recompute target geometry on `resize` / `scroll`, and keep the overlay above all existing popovers/modals. Mobile is intentionally out of scope for this entry — a follow-up will adapt the flow for narrow viewports.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-05-18

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
