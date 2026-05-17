# TODO List

## Bugs

- [x] **[MEDIUM]** Unify nav, sidebar, and todo row visual language with accent-tinted borders
  - Description: The current UI has inconsistent border and background treatments across the three major surfaces — the nav bar uses neutral `--border-dim` separators, the sidebar uses `--bg-elevated` with neutral borders, and todo rows are flat with neutral hairlines. Shift all dividing lines (nav bottom border, sidebar right border, project row separators, todo row separators, completed header border) to a consistent low-opacity purple (`rgba(108,93,245,0.10–0.15)`) so every section reads as part of one accent-tinted system. Also update the view-switcher pills (PROJECTS / TODAY / CALENDAR) from a fully solid fill to a semi-transparent accent fill on active (`rgba(108,93,245,0.20)` bg + `#6C5DF5` border + `#9D93EE` text) and a subtle accent-tinted border on inactive (`rgba(108,93,245,0.35)` border, `--text-muted` text). Checkboxes on todo rows should adopt `border-color: rgba(108,93,245,0.4)` to match. The base background tone and elevation model stay the same — this is purely a border/separator color pass.
  - Behavior:
    1. Nav bottom border: `border-bottom: 0.5px solid rgba(108,93,245,0.20)`
    2. Sidebar right border: `border-right: 0.5px solid rgba(108,93,245,0.15)`
    3. Project row separators: `border-bottom: 0.5px solid rgba(108,93,245,0.10)`
    4. Todo row separators (`#toDoChild` border-bottom): `0.5px solid rgba(108,93,245,0.10)`
    5. Completed header border-top: same `rgba(108,93,245,0.10)`
    6. Active view pill: `background: rgba(108,93,245,0.20)`, `border: 0.5px solid #6C5DF5`, `color: #9D93EE`, `border-radius: 6px` (square-ish, not fully round)
    7. Inactive view pill: `background: transparent`, `border: 0.5px solid rgba(108,93,245,0.35)`, `color: var(--text-muted)`, same border-radius
    8. Todo row checkbox border: `rgba(108,93,245,0.4)` to match the purple family
  - Implementation notes:
    - All changes are CSS-only in `style.css`. No JS changes required.
    - Todo row borders are currently set via inline JS styles in `main.js` — grep for `border` assignments on `#toDoChild` and verify which are CSS-driven vs inline. Inline styles will override the CSS change and must be updated in `main.js` too.
    - The view-switcher pills (`#tabProjects`, `#tabToday`, `#tabCalendar`) currently use a solid `--accent` fill for the active state — switch to the semi-transparent treatment above.
    - Neutral `--border-dim` / `--border-bright` replacements should only target the structural dividers listed above — don't touch component-internal borders (context menus, popovers, modals, drag indicators).
    - Verify dark theme: `rgba(108,93,245,0.10–0.20)` is light enough not to create visual noise on `--bg-elevated` but should remain visible. Spot-check against the light theme if it exists.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-05-17

## Features

- [ ] **[LOW]** React ghost companion to Pomodoro timer state with studying and wandering behaviors
  - Description: When the Pomodoro timer is RUNNING, the ghost companion should stop wandering, hold position, and display a new "studying" sprite variant showing a small pixel book held to the right side of the body. When the timer is PAUSED or STOPPED, the ghost resumes its normal wander behavior. When the timer session completes, the existing `cheer()` call fires as usual, then wander resumes. The idle bob animation (`companionIdle`) continues during the studying state — only the wander timer and position lerp are suspended.
  - Behavior:
    1. Add a new `STUDYING` state to `companion.js` alongside `IDLE`, `WALKING`, `CHEERING`. `setState('STUDYING')` suspends the wander `timerId` and `rafId`, applies `.studying` class, keeps the idle bob running.
    2. Add `setStudying(active)` to the companion's public API. Call with `true` when pomodoro status becomes `RUNNING`, `false` when it becomes `PAUSED`, `STOPPED`, or `COMPLETE`.
    3. Wire `setStudying` in `main.js` (or `pomodoro.js`) wherever `data-pomo-status` is written to `#pomodoroToggle` — mirror the same call sites that already update the icon color and border.
    4. New sprite: `companion-ghost-study.svg` — same 48×56px pixel ghost body, small amber/gold pixel book held to the right (occupying roughly the bottom-right quadrant, ~6×5px book block at the ghost's side). Book spine faces left, pages open rightward.
    5. `.companion.studying` CSS rule: `background-image: url('./assets/companion-ghost-study.svg')`. Width expands to accommodate the book (~64px wide), `background-size: 100% 100%`.
    6. Studying state also suppresses blinks (same guard as `CHEERING`) — the focused-study read is cleaner without the distraction.
    7. Transition into/out of `STUDYING` must not disrupt an in-progress `CHEERING` — if `setStudying(true)` is called while cheering, defer until the cheer timer resolves.
  - Implementation notes:
    - `companion.js` owns all state logic. `main.js`/`pomodoro.js` only calls `setStudying()` — no inline style writes or class manipulations outside the module.
    - `data-pomo-status` is already set on `#pomodoroToggle` by the pomodoro wiring in `main.js`; grep for `data-pomo-status` to find all write sites and add `setStudying` calls alongside them.
    - The sprite is a new SVG asset in `src/assets/` — same pixel style and color palette as `companion-ghost.svg` (`#7B6FE8` body, `#1a1828` eyes). Book uses `#d4a843` / `#f0c050` / `#ba7517` (amber ramp) for cover/pages/spine to match the due-date pill amber.
    - Width expansion for the book means the right-edge clamping in `pickTarget` / `placeInitial` should account for the wider footprint — use 64px instead of 48px for the right-margin calculation when in `STUDYING` state.
    - No new dependencies. SVG is inline-authored, no library needed.
  - Out of scope: per-session study pose variations, book title text, reading page-turn animation.
  - File: `toDoList_main/src/companion.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/assets/companion-ghost-study.svg`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
