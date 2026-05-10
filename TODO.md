# TODO List

## Bugs

- [ ] **[MEDIUM]** Add arrow-key navigation between sidebar, header buttons, and footer
  - Description: The header controls (sidebarToggle, pomodoroToggle, musicToggle, settingsToggle), the projects sidebar, and the footer version label are reachable only via Tab — there's no spatial arrow-key flow between them, which makes keyboard navigation feel disjointed. Add arrow-key navigation between these regions in directions that match the on-screen layout: Up from the top project row jumps to sidebarToggle, Right walks across the header buttons, and Down from the bottom projButton lands on footVersionLabel.
  - Behavior:
    1. From the top project row in the sidebar, ArrowUp focuses `sidebarToggle`.
    2. From `sidebarToggle`, ArrowRight focuses `pomodoroToggle`; again to `musicToggle`; again to `settingsToggle`. ArrowLeft reverses the chain back to `sidebarToggle`.
    3. From `projButton` (bottom of sidebar), ArrowDown focuses `footVersionLabel`.
    4. Arrow keys must not interfere with the existing Up/Down behavior inside the project list — the new transitions only fire at the boundary positions (focus on first project row, focus on last/`projButton`, focus on the named header buttons).
    5. Each landed element shows the existing `:focus-visible` ring so keyboard users can see where focus moved.
  - Implementation notes:
    - Add a delegated `keydown` listener (or per-element listeners) keyed on `e.key` for `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`, calling `targetEl.focus()` and `e.preventDefault()` to suppress page scroll.
    - For the sidebar boundaries, use the existing `document.querySelector('.selectedProject')` pattern plus a first/last-child check on the project list rather than closure-scoped variables, matching the convention elsewhere in `main.js`.
    - `main.js` is over 25k tokens — locate the existing project-row and header-button event wiring with grep + offset/limit before adding handlers; co-locate the new logic with each element's existing listeners rather than introducing a new top-level block.
  - Acceptance criteria:
    - Tab order is unchanged; arrow keys are additive, not a replacement.
    - All five transitions above work in both directions where specified.
    - No arrow-key handler hijacks input typing inside the "Add a task" field, the project rename field, or any modal text input.
  - Out of scope: full roving-tabindex refactor, new focus-ring styling, keyboard shortcuts other than the arrow keys listed above.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Add Ctrl+Pause global shortcut to toggle Pomodoro timer with status pill
  - Description: Wire a global `Ctrl + Pause/Break` keyboard shortcut that toggles the Pomodoro timer between running and paused, regardless of where focus is in the app (no input-suppression needed since the combo doesn't collide with text entry). On every toggle, surface a brief auto-fading status pill near the top of the Pomodoro popover — amber `Paused` (with `ti-player-pause` icon) when pausing, primary-purple `Play` (with `ti-player-play` icon) when resuming — so the user gets definitive visual confirmation that the toggle landed. If the popover is already open when the shortcut fires, the pill just appears inside it and fades. If the popover is closed, the popover opens, shows the pill, and auto-closes after the pill finishes fading so the user gets the confirmation without having to manually dismiss anything.
  - Behavior:
    1. Global `keydown` listener on `document` checks for `e.ctrlKey && e.key === 'Pause'`. On match, call `e.preventDefault()` and invoke the Pomodoro toggle.
    2. State machine: idle → Start (shows `Play` pill); running → Pause (shows `Paused` pill); paused → Resume (shows `Play` pill). Pomodoro at 00:00 / completed = no-op (don't auto-restart).
    3. Pill renders inside the popover header area, between `POMODORO` and the tab row. Visible for ~1.2s at full opacity, then fades over ~400ms (CSS transition on opacity).
    4. If popover was closed when shortcut fired, open it, render pill, then auto-close popover ~200ms after pill finishes fading (~1.8s total visible). If popover was already open, leave it open — only the pill fades.
    5. Rapid repeated presses cancel and restart the fade timer for the new pill, so the indicator always reflects the latest toggle.
  - Implementation notes:
    - Global listener belongs in `main.js` alongside the existing keyboard wiring; bootstrap it once on app init, not per popover open.
    - `pomodoro.js` already follows the factory/singleton pattern with its own state — expose a `toggle()` method (or reuse existing `pause()` / `resume()` / `start()` and dispatch based on current state) so `main.js` only calls one entry point.
    - The auto-close-after-toggle path is timer-driven, not user-driven, so it doesn't need to honor the modal's "close 3 ways" convention — it's a transient confirmation, not a modal interaction. Worth a one-line comment in the close handler noting this is the shortcut path.
    - Pill styling: amber pill uses `border: 1px solid rgba(240,160,48,0.45)` + `background: rgba(240,160,48,0.10)` + amber dot or `ti-player-pause` icon at 11px. Play pill uses the same shape with the primary `#6C5DF5` ramp + `ti-player-play` icon. Both share a single `.pomodoroStatusPill` class with state-modifier classes (`.paused`, `.playing`).
    - Fade-out animation in CSS only (no JS animation libs) — `opacity 1 → 0` over 400ms, paired with a `setTimeout` that removes the pill from the DOM after the transition completes.
    - The `Pause/Break` key reports as `e.key === 'Pause'` in modern browsers; verify this on the user's primary browser before shipping (some keyboards lack the key entirely — note this as a known limitation, not a bug).
  - Acceptance criteria:
    - Pressing `Ctrl+Pause` while typing in the new-todo input still toggles the timer (the combo is not suppressed by input focus).
    - Pill appears in correct color/label for each transition and fully fades within ~1.6s.
    - Closed-popover path opens the popover, shows the pill, and auto-closes; open-popover path leaves the popover open.
    - Shortcut at 00:00 is a no-op (no pill, no popover open).
  - Out of scope: any change to existing Start/Reset button labels or layout (this entry only adds the keyboard path and the pill); changes to music player pause/resume coordination (existing behavior preserved); a settings UI to rebind the shortcut.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/pomodoro.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-09

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
