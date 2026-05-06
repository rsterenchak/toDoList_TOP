# TODO List

## Bugs

- [x] **[LOW]** Auto-focus emptyStateCreateBtn and bind Enter to create first project
  - Description: When the app loads with no existing projects, the "CREATE YOUR FIRST PROJECT" empty-state button (`emptyStateCreateBtn`) doesn't receive focus, so keyboard users have to tab or click into it to get started. Apply focus to the button on render of the empty state, and ensure pressing Enter while it's focused triggers the same new-project creation flow as a click — which it should already do as a `<button>`, but verify rather than assume. Focus should only auto-apply on the empty state itself, not re-steal focus if the user has already moved to another control (e.g., the hamburger menu) by the time the empty state renders. Implementation lives in `main.js` where the empty state is rendered — grep for `emptyStateCreateBtn` with `offset`/`limit` since `main.js` is over 25k tokens — and call `.focus()` on the button after it's appended to the DOM. Verify the existing `:focus-visible` style in `style.css` reads clearly against the empty-state background; if not, add a focus treatment matching other primary buttons.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-05

## Features

- [ ] **[MEDIUM]** Add Pomodoro timer with completion alerts to header
  - Description: Add a clock-icon button to the top-bar's right cluster that opens a small popover with mode tabs (Focus / Short / Long), an inline-editable MM:SS countdown, and Start/Reset controls. Click the countdown to edit each mode's duration; durations, last-used mode, and sound preferences persist in localStorage under a `todoapp_pomodoro_` prefix. Starting a session closes the popover and recolors the icon to the accent, with the SVG minute hand sweeping a full clockwise revolution over the session duration as ambient progress feedback. Use an end-timestamp anchor (`endTs - performance.now()` per tick) rather than `setInterval` arithmetic so the timer survives a refresh and doesn't drift in inactive tabs.
  - Behavior:
    1. Idle: muted clock icon, hand at 12.
    2. Click icon → popover opens with the current mode and countdown. Click MM:SS to edit duration; click a mode tab to swap.
    3. Start → popover closes; icon recolors accent; hand begins sweeping clockwise over the session duration.
    4. Click icon while running → popover reopens with live countdown and Pause/Resume.
    5. Completion → fires the alert sequence (below) and stays in the unacknowledged state until the user clicks the clock icon or starts the next session.
    6. After a session ends, the popover (when reopened) auto-suggests the next mode with a one-click advance — Focus → "Start short break", break → "Start focus session". The suggested duration remains inline-editable before starting.
  - Completion alert (four visual layers + audio):
    - Icon pulse: brief scale animation on the clock button, then settles into a solid accent-fill state held until acknowledged.
    - Tab title flash: alternates `Break time! — Task Management` ↔ `Task Management` every ~700ms; clears on `visibilitychange` (tab regains focus) or on user acknowledgment.
    - Favicon swap: switches to an accent-colored variant while the alert is unacknowledged; reverts on acknowledgment.
    - Browser Notification: `new Notification('toDoList', { body, icon })` fired in parallel; no-ops gracefully if permission is denied. Permission requested lazily on the first Start click — not on page load.
    - Audio: synthesized "soft bell" via Web Audio API (sine 880Hz fundamental + 1320Hz partial, ~1.6s exponential decay). Volume defaults to 60%; sound on/off toggle and volume both persist.
  - Implementation notes:
    - New module `pomodoro.js` mirrors `companion.js`'s shape — exports `createPomodoro(doc)` returning a controller `{ start, pause, reset, setMode, setDuration, acknowledge, subscribe, destroy }`. Holds no project/todo state; does not touch `listLogic.js`.
    - State machine: IDLE → RUNNING → PAUSED → RUNNING → COMPLETE_UNACKED → IDLE (via `acknowledge()` or by starting the next session).
    - Persisted shape under `todoapp_pomodoro_state`: `{ mode, durations: {focus, short, long}, endTimestamp, status, soundEnabled, volume }`.
    - Popover dismissal: outside click, Escape, or icon re-click — matches the existing context-menu and due-date-popover patterns.
    - Mobile-safe duration edit: the inline input needs `font-size: 16px+` to avoid iOS Safari auto-zoom.
    - `prefers-reduced-motion`: hand sweep snaps in ~5° increments instead of continuous rotation; icon pulse and slide animations are skipped.
    - Vanilla / no new dependencies — Web Audio, Notification, and Page Visibility APIs are all native.
    - `main.js` is over 25k tokens — wire the icon and popover via grep + offset/limit, near the existing theme-toggle setup.
    - Asset: commit a small accent-tinted favicon variant alongside the existing favicon for the unacknowledged-state swap target.
  - Out of scope: per-todo Pomodoro association (linking sessions to specific items, completed-cycle counters), automatic focus → break promotion without the acknowledgment step, custom audio-file uploads, configurable long-break-every-N-cycles logic.
  - File: `toDoList_main/src/pomodoro.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/index.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
