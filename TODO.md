# TODO List

## Bugs

- [x] **[LOW]** Move Open in YouTube arrow to Focus Music modal header
  - Description: Relocate the per-row `↗` external-link arrows in the Focus Music popover to a single icon-only button in the top-right corner of the modal header. The header becomes a three-column grid — empty left slot, centered "FOCUS MUSIC" label, `ti-external-link` icon button right — so the title stays visually centered while the action sits where users expect modal controls. Clicking the header arrow opens the currently-playing station's YouTube URL in a new tab (`target="_blank" rel="noopener"`); if nothing is playing yet, fall back to `https://www.youtube.com`. Add `aria-label="Open in YouTube"` and a `title` attribute for tooltip on hover. Remove the trailing `↗` from each row in both the Curated and Your Stations sections — each curated row becomes `<title> <genre tag>`, each custom row becomes `<title> CUSTOM <X>`. The X (delete) button on custom stations stays.
  - Behavior:
    1. Header renders the icon button at all times (visible whether signed in or not, whether playing or not).
    2. Click resolves the URL from the current station state in `todoapp_music_state` — prefer the active station's source URL, otherwise YouTube homepage.
    3. Per-row arrows are removed from both row-builder paths (Curated and Your Stations) so the row markup is shorter and each row's right side is calmer.
  - Implementation notes:
    - Header lives in the Focus Music modal markup in `main.js` — search for the existing `FOCUS MUSIC` label to find it. Convert the current single-element header into a CSS grid with `grid-template-columns: 1fr auto 1fr` (or 18px / 1fr / 18px) so the title remains centered regardless of icon width.
    - Use a real `<button>` (not an `<a>`) wired to a click handler that computes the URL and calls `window.open(url, '_blank', 'noopener')` — keeps the keyboard/focus behavior consistent with other modal buttons.
    - Style the icon button to match the existing modal-control aesthetic (transparent bg, muted-purple stroke on hover, ~28×28px hit target). No new icon library needed — use the same SVG/icon-font approach already in use elsewhere in `main.js`.
    - This change does not fix the underlying YouTube embed sign-in bot-gate; it gives the user a working escape hatch by letting them authenticate on youtube.com directly.
  - Out of scope: any iframe `sandbox` or popup permission changes (covered by the separate sign-in bug entry); changes to the player controls bar or section ordering.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-09

## Features

- [ ] **[MEDIUM]** Add Ctrl+Pause global shortcut to toggle Pomodoro timer with status pill
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
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
